// Admin AI Credits page — provider health, auto-topup status, grant form.

import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { KpiCard, Skeleton, useToast, InputModal } from './AdminComponents'
import { ensureCsrfToken } from '../../lib/api'

function isOpenRouterUsageOnly(card) {
  const id = String(card?.id || card?.provider || card?.name || '').toLowerCase()
  const text = String(card?.balanceDisplay || card?.message || '').toLowerCase()
  return id.includes('openrouter') && (
    text.includes('used (no limit)') ||
    text.includes('no limit') ||
    text.includes('key usage') ||
    text.includes('used')
  ) && !text.includes('available') && !text.includes('remaining')
}

function balanceLabel(card) {
  if (isOpenRouterUsageOnly(card)) return 'Consum pe cheie, nu sold'
  if (card?.kind === 'revenue') return 'Sold'
  return 'Sold real'
}

function autoTopupAmountLabel(autoTopup) {
  const amount = autoTopup?.amountEur ?? autoTopup?.amount
  if (!Number.isFinite(Number(amount))) return 'neconfigurata'
  const currency = String(autoTopup?.currency || 'eur').toUpperCase()
  return `${amount} ${currency}`
}

function autoTopupThresholdLabel(autoTopup) {
  const value = Number(autoTopup?.threshold)
  if (!Number.isFinite(value)) return 'neconfigurat'
  return value > 1 ? `${value}%` : `${Math.round(value * 100)}%`
}

function friendlyStatus(card) {
  if (isOpenRouterUsageOnly(card)) {
    return { headline: 'Cheia merge; soldul real nu e verificat', tone: 'warn' }
  }
  if (!card) return { headline: '—', tone: 'muted' }
  switch (card.status) {
    case 'ok': return { headline: 'Credit suficient ✓', tone: 'ok' }
    case 'low': return { headline: 'Credit aproape terminat — reîncarcă →', tone: 'warn' }
    case 'error': return { headline: 'Problemă cu cheia — verifică →', tone: 'error' }
    case 'unconfigured': return { headline: 'Neconfigurat', tone: 'muted' }
    default: return { headline: card.balanceDisplay || 'Necunoscut', tone: 'muted' }
  }
}

function providerName(card) {
  if (!card) return 'Provider necunoscut'
  const known = {
    openrouter: 'OpenRouter',
    elevenlabs: 'ElevenLabs',
    stripe: 'Stripe',
    railway: 'Railway',
    google: 'Google AI Studio',
    googleai: 'Google AI Studio',
    supabase: 'Supabase',
  }
  const id = String(card.id || card.provider || '').toLowerCase()
  return card.providerLabel || card.name || known[id] || card.provider || card.id || 'Provider necunoscut'
}

function clampPct(value) {
  if (!Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, Math.round(value)))
}

function providerGauge(card, split) {
  const id = String(card?.id || card?.provider || card?.name || '').toLowerCase()
  if (id.includes('openrouter') && split?.reserve) {
    const available = Number(split.reserve.openrouterAvailableUsd)
    const buffer = Number(split.reserve.minOpenRouterBufferUsd)
    const percent = buffer > 0 ? clampPct((available / buffer) * 100) : null
    return {
      percent,
      label: 'OpenRouter buffer',
      value: Number.isFinite(available) && Number.isFinite(buffer)
        ? `$${available.toFixed(2)} / $${buffer.toFixed(2)}`
        : card?.balanceDisplay || 'neverificat',
    }
  }
  const balance = Number(card?.balance)
  const limit = Number(card?.balanceLimit || card?.limit || card?.quota || card?.minBuffer)
  if (Number.isFinite(balance) && Number.isFinite(limit) && limit > 0) {
    return {
      percent: clampPct((balance / limit) * 100),
      label: balanceLabel(card),
      value: `${balance.toFixed(2)} / ${limit.toFixed(2)}`,
    }
  }
  if (isOpenRouterUsageOnly(card)) {
    return { percent: null, label: 'Sold real', value: 'neverificat' }
  }
  return { percent: null, label: balanceLabel(card), value: card?.balanceDisplay || 'neverificat' }
}

function CreditGauge({ percent, label, value, tone = 'ok', size = 76 }) {
  const pct = percent == null ? 0 : clampPct(percent)
  const toneColor = tone === 'error'
    ? 'var(--admin-red)'
    : tone === 'warn'
      ? 'var(--admin-amber)'
      : 'var(--admin-green)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 180 }}>
      <div
        aria-label={`${label}: ${percent == null ? 'neverificat' : `${pct}%`}`}
        title={`${label}: ${value}`}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: `conic-gradient(${toneColor} ${pct * 3.6}deg, rgba(148,163,184,.18) 0deg)`,
          display: 'grid',
          placeItems: 'center',
          boxShadow: `0 0 0 1px ${toneColor}33 inset`,
          flex: '0 0 auto',
        }}
      >
        <div style={{
          width: size - 18,
          height: size - 18,
          borderRadius: '50%',
          background: 'var(--admin-surface)',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 800,
          fontSize: 13,
          color: percent == null ? 'var(--admin-text-dim)' : toneColor,
        }}>
          {percent == null ? '?' : `${pct}%`}
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--admin-text-dim)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--admin-text)', wordBreak: 'break-word' }}>{value}</div>
      </div>
    </div>
  )
}

export default function AiCreditsPage() {
  const { getCsrfToken } = useOutletContext()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [cards, setCards] = useState([])
  const [autoTopup, setAutoTopup] = useState(null)
  const [split, setSplit] = useState(null)
  const [grantModal, setGrantModal] = useState({ open: false })
  const [grantBusy, setGrantBusy] = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const opts = { credentials: 'include' }
      const [cR, sR] = await Promise.allSettled([
        fetch('/api/admin/credits', opts).then(r => r.ok ? r.json() : null),
        fetch('/api/admin/revenue-split?days=30', opts).then(r => r.ok ? r.json() : null),
      ])
      if (cR.status === 'fulfilled' && cR.value) {
        setCards(Array.isArray(cR.value.cards) ? cR.value.cards : [])
        setAutoTopup(cR.value.autoTopup || null)
      }
      if (sR.status === 'fulfilled') setSplit(sR.value)
    } catch (_) {
      toast?.error?.('Nu am putut încărca AI credits')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { fetchAll() }, [fetchAll])

  const handleGrant = useCallback(async (values) => {
    const email = (values.email || '').trim().toLowerCase()
    const minutes = Number(values.minutes)
    if (!email || !/.+@.+\..+/.test(email)) {
      toast?.error?.('Introdu un email valid')
      return
    }
    if (!Number.isFinite(minutes) || minutes === 0) {
      toast?.error?.('Introdu un număr valid de minute')
      return
    }
    setGrantBusy(true)
    try {
      const rand = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const idempotencyKey = `admin:${email}:${minutes}:${rand}`
      const csrf = await ensureCsrfToken()
      const r = await fetch('/api/admin/credits/grant', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf || getCsrfToken(),
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ email, minutes: Math.trunc(minutes), note: values.note || '', idempotencyKey }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      toast?.success?.(body.duplicate
        ? `Deja acordat (duplicat). Sold: ${body.balanceMinutes} min.`
        : `Acordat ${body.deltaMinutes} min → ${body.email}. Sold: ${body.balanceMinutes} min.`
      )
      setGrantModal({ open: false })
    } catch (err) {
      toast?.error?.(err.message)
    } finally {
      setGrantBusy(false)
    }
  }, [getCsrfToken, toast])

  const toneColors = { ok: 'var(--admin-green)', warn: 'var(--admin-amber)', error: 'var(--admin-red)', muted: 'var(--admin-text-dim)' }
  const toneBg = { ok: 'var(--admin-green-bg)', warn: 'var(--admin-amber-bg)', error: 'var(--admin-red-bg)', muted: 'var(--admin-surface-2)' }

  return (
    <div>
      {/* Split overview */}
      {split && (
        <div className="kpi-grid" style={{ marginBottom: 20 }}>
          <KpiCard icon="💰" label="Venit brut (30z)" value={split.revenue?.grossDisplay || '—'} accent="#10b981" />
          <KpiCard icon="🧠" label={`Alocare AI (${Math.round((split.fraction || 0.5) * 100)}%)`} value={split.allocation?.display || '—'} accent="#f472b6" />
          <KpiCard icon="💸" label="Profit disponibil" value={split.allocation?.protectedOwnerDisplay || split.allocation?.ownerDisplay || '—'} accent="#a78bfa" />
        </div>
      )}

      {split?.reserve && (
        <div className="admin-card" style={{ marginBottom: 16 }}>
          <div className="admin-card-header">
            <div className="admin-card-title">AI reserve real</div>
            <div style={{
              color: split.reserve.ok ? 'var(--admin-green)' : 'var(--admin-amber)',
              fontSize: 12,
              fontWeight: 700,
            }}>
              {split.reserve.status || (split.reserve.ok ? 'acoperit' : 'sub buffer')}
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' }}>
            <CreditGauge
              percent={Number(split.reserve.minOpenRouterBufferUsd) > 0
                ? (Number(split.reserve.openrouterAvailableUsd) / Number(split.reserve.minOpenRouterBufferUsd)) * 100
                : null}
              label="OpenRouter buffer"
              value={`$${Number(split.reserve.openrouterAvailableUsd || 0).toFixed(2)} / $${Number(split.reserve.minOpenRouterBufferUsd || 0).toFixed(2)}`}
              tone={split.reserve.ok ? 'ok' : 'warn'}
              size={88}
            />
            <div style={{ fontSize: 13, color: 'var(--admin-text-dim)', maxWidth: 680 }}>
              {split.reserve.message || 'Profitul devine retragibil doar dupa ce bufferul AI este acoperit.'}
            </div>
          </div>
        </div>
      )}
      {/* Auto-topup status */}
      {autoTopup && (
        <div className="admin-card" style={{ marginBottom: 16 }}>
          <div className="admin-card-title" style={{ marginBottom: 8 }}>⚡ Auto-Topup</div>
          <div style={{ fontSize: 13, color: 'var(--admin-text-dim)' }}>
            {autoTopup.enabled
              ? `Activ - Prag: ${autoTopupThresholdLabel(autoTopup)} - Suma: ${autoTopupAmountLabel(autoTopup)} - Ultimul: ${autoTopup.lastRun || '-'}`
              : 'Dezactivat'
            }
          </div>
        </div>
      )}

      {/* Provider cards */}
      <div className="admin-card">
        <div className="admin-card-header">
          <div className="admin-card-title">🔌 Provideri AI</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="admin-btn sm" onClick={() => setGrantModal({ open: true })}>
              💰 Acordă credite
            </button>
            <button className="admin-btn sm" onClick={fetchAll} disabled={loading}>
              {loading ? '…' : '🔄 Refresh'}
            </button>
          </div>
        </div>
        {loading ? <Skeleton height={120} count={3} /> : (
          cards.length === 0 ? (
            <div className="admin-empty">
              <div className="admin-empty-icon">🔌</div>
              <div className="admin-empty-text">Niciun provider AI configurat.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {cards.map((card) => {
                const st = friendlyStatus(card)
                const gauge = providerGauge(card, split)
                return (
                  <div key={card.id || card.provider || providerName(card)} style={{
                    padding: '16px 20px',
                    background: toneBg[st.tone],
                    borderRadius: 10,
                    border: `1px solid ${toneColors[st.tone]}30`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                  }}>
                    <CreditGauge percent={gauge.percent} label={gauge.label} value={gauge.value} tone={st.tone} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        {providerName(card)}
                      </div>
                      <div style={{ fontSize: 13, color: toneColors[st.tone], marginTop: 2 }}>
                        {st.headline}
                      </div>
                      {card.balanceDisplay && (
                        <div style={{ fontSize: 12, color: 'var(--admin-text-dim)', marginTop: 4 }}>
                          {balanceLabel(card)}: {card.balanceDisplay}
                        </div>
                      )}
                      {card.message && (
                        <div style={{ fontSize: 11, color: 'var(--admin-text-muted)', marginTop: 2 }}>
                          {card.message}
                        </div>
                      )}
                    </div>
                    {card.dashboardUrl && (
                      <a
                        href={card.dashboardUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="admin-btn sm"
                        style={{ textDecoration: 'none' }}
                      >
                        Deschide →
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>

      <InputModal
        open={grantModal.open}
        title="Acordă credite — formular admin"
        fields={[
          { key: 'email', label: 'Email utilizator', placeholder: 'user@kelionai.app' },
          { key: 'minutes', label: 'Minute (negativ = retragi)', placeholder: '33', type: 'number' },
          { key: 'note', label: 'Notă (opțional)', placeholder: 'Refund, compensare, bonus…' },
        ]}
        submitLabel="Acordă"
        busy={grantBusy}
        onSubmit={handleGrant}
        onCancel={() => setGrantModal({ open: false })}
      />
    </div>
  )
}
