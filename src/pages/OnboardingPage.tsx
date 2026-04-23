import { useState, useMemo } from "react";
import { setSelectedMemberships, setOnboardingComplete } from "@/lib/storage";
import { useNavigate } from "react-router-dom";
import { useMemberships, DbMembership } from "@/hooks/useDiscounts";
import { MEMBERSHIP_LOGOS } from "@/data/mockData";

// ── Membership categories ─────────────────────────────────────────────────────
const MEMBERSHIP_CATEGORIES: Record<string, string[]> = {
  "💳 כרטיסי אשראי": ["cal", "max", "iscard", "visa-cal", "isracard-benefits"],
  "🏦 בנקים": ["bank-hapoalim", "bank-leumi", "bank-discount", "bank-mizrahi", "bank-yahav", "bank-benleumi", "poalim-wonder", "mafteah-discount"],
  "🏥 קופות חולים": ["clalit", "maccabi", "leumit", "meuhedet"],
  "🎖️ צבא וביטחון": ["behatzada", "hever", "idf-disabled", "police"],
  "✊ הסתדרויות": ["histadrut", "histadrut-morim", "histadrut-medina", "histadrut-refuit"],
  "🛒 מועדוני צרכנות": ["face", "clubhub", "pais-plus", "hofesh", "rami-levy-club", "shufersal-club"],
  "📱 תקשורת ואנרגיה": ["hot-club", "partner", "cellcom", "pelephone", "yellow-paz", "sonol"],
  "🛡️ ביטוח": ["migdal", "harel", "menora", "clal-insurance"],
  "⚖️ לשכות מקצועיות": ["lishkat-orchei-din", "lishkat-roei-heshbon"],
};

const MEMBERSHIP_EMOJIS: Record<string, string> = {
  "behatzada": "🎖️", "hever": "🤝", "idf-disabled": "🎗️", "police": "👮",
  "bank-hapoalim": "🏦", "bank-leumi": "🏦", "bank-discount": "🏦",
  "bank-mizrahi": "🏦", "bank-yahav": "🏦", "bank-benleumi": "🏦",
  "poalim-wonder": "✨", "mafteah-discount": "🔑",
  "cal": "💳", "max": "💳", "iscard": "💳", "visa-cal": "💳", "isracard-benefits": "💳",
  "clalit": "🏥", "maccabi": "🏥", "leumit": "🏥", "meuhedet": "🏥",
  "histadrut": "✊", "histadrut-morim": "📚", "histadrut-medina": "🏛️", "histadrut-refuit": "⚕️",
  "hot-club": "📺", "partner": "📱", "cellcom": "📱", "pelephone": "📱",
  "yellow-paz": "⛽", "sonol": "⛽",
  "migdal": "🛡️", "harel": "🛡️", "menora": "🛡️", "clal-insurance": "🛡️",
  "face": "😊", "clubhub": "🎯", "pais-plus": "🎰", "hofesh": "🌴",
  "lishkat-orchei-din": "⚖️", "lishkat-roei-heshbon": "📊",
  "rami-levy-club": "🛒", "shufersal-club": "🛒",
};

const ALL_CATEGORIZED_SLUGS = new Set(Object.values(MEMBERSHIP_CATEGORIES).flat());

// ── Welcome screen ────────────────────────────────────────────────────────────
function WelcomeScreen({ onNext }: { onNext: () => void }) {
  return (
    <div style={{
      minHeight: '100vh', background: 'var(--lf-bg)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '40px 28px', position: 'relative', overflow: 'hidden',
    }}>
      {/* Ambient glow */}
      <div style={{
        position: 'absolute', top: '12%', left: '50%', transform: 'translateX(-50%)',
        width: 340, height: 340, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255,210,63,0.4) 0%, transparent 70%)',
        filter: 'blur(32px)', pointerEvents: 'none',
      }}/>
      {/* Wordmark */}
      <div className="lf-slide-up" style={{ position: 'relative', zIndex: 1, textAlign: 'center', marginBottom: 20 }}>
        <div style={{
          fontFamily: "'Rubik', sans-serif",
          fontWeight: 900, fontSize: 80,
          lineHeight: 0.9, letterSpacing: -4,
          background: 'linear-gradient(120deg, var(--lf-primary) 0%, var(--lf-pink) 55%, var(--lf-coral) 100%)',
          WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
        }}>lofrayer</div>
        <div style={{
          display: 'inline-block', width: 14, height: 14, borderRadius: '50%',
          background: 'var(--lf-yellow)', marginRight: 6,
          boxShadow: '0 2px 0 rgba(0,0,0,0.08)', verticalAlign: 'top', marginTop: 4,
        }}/>
      </div>

      <p style={{
        fontSize: 19, color: 'var(--lf-ink-2)', fontWeight: 500,
        textAlign: 'center', lineHeight: 1.5, maxWidth: 300, marginBottom: 48,
        position: 'relative', zIndex: 1,
        animation: 'slideUp .6s .15s cubic-bezier(.22,1,.36,1) both',
      }}>
        כל ההנחות של כל המועדונים שלך,<br/>במקום אחד. לקנייה חכמה.
      </p>

      <div className="lf-cta-float" style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 360 }}>
        <button
          className="lf-tap"
          onClick={onNext}
          style={{
            width: '100%', padding: '18px 26px', borderRadius: 999,
            background: 'var(--lf-ink)', color: 'var(--lf-bg)',
            fontFamily: "'Rubik', sans-serif", fontWeight: 700, fontSize: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            border: 'none', cursor: 'pointer',
          }}>
          בואו נתחיל ←
        </button>
      </div>
    </div>
  );
}

// ── Club chip ─────────────────────────────────────────────────────────────────
function ClubChip({ membership, selected, onToggle }: {
  membership: DbMembership;
  selected: boolean;
  onToggle: () => void;
}) {
  const logo = MEMBERSHIP_LOGOS[membership.slug];
  const emoji = MEMBERSHIP_EMOJIS[membership.slug] || "🏷️";

  return (
    <button
      onClick={onToggle}
      className="lf-tap"
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
      }}
    >
      <div style={{
        width: 58, height: 58, borderRadius: '50%',
        background: selected ? 'var(--lf-ink)' : '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: selected
          ? '0 0 0 3px var(--lf-bg), 0 0 0 5px var(--lf-ink), 0 6px 18px rgba(109,40,255,0.3)'
          : '0 3px 10px rgba(0,0,0,0.1)',
        transition: 'all .2s ease',
        transform: selected ? 'scale(1.05)' : 'scale(1)',
        overflow: 'hidden', position: 'relative', flexShrink: 0,
      }}>
        {logo ? (
          <img
            src={logo} alt={membership.name}
            style={{
              width: 38, height: 38, objectFit: 'contain', borderRadius: 6,
              filter: selected ? 'brightness(0) invert(1)' : 'none',
              transition: 'filter .2s ease',
            }}
          />
        ) : (
          <span style={{ fontSize: 22, lineHeight: 1 }}>{emoji}</span>
        )}
        {selected && (
          <div style={{
            position: 'absolute', top: 0, left: 0,
            width: 20, height: 20, borderRadius: '50%',
            background: 'var(--lf-mint)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid var(--lf-bg)',
          }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
              <path d="M4 12l5 5 11-12" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        )}
      </div>
      <div style={{
        fontSize: 10, fontWeight: 600, textAlign: 'center',
        color: 'var(--lf-ink)', lineHeight: 1.2, maxWidth: 64,
      }}>{membership.name}</div>
    </button>
  );
}

// ── Club selection screen ─────────────────────────────────────────────────────
function ClubsScreen({ onComplete }: { onComplete: (clubs: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const { data: memberships = [], isLoading } = useMemberships();

  const filtered = useMemo(() => {
    if (!search) return memberships;
    return memberships.filter(m =>
      m.name.includes(search) || m.slug.includes(search.toLowerCase())
    );
  }, [memberships, search]);

  const uncategorized = useMemo(
    () => filtered.filter(m => !ALL_CATEGORIZED_SLUGS.has(m.slug)),
    [filtered]
  );

  const toggle = (slug: string) => {
    setSelected(prev => prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug]);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--lf-bg)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '32px 24px 0' }}>
        {/* Progress */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 28 }}>
          {[0,1].map(i => (
            <div key={i} style={{
              flex: 1, height: 4, borderRadius: 999,
              background: i === 1 ? 'var(--lf-ink)' : 'var(--lf-line)',
            }}/>
          ))}
        </div>

        <div style={{
          fontFamily: "'Fraunces', Georgia, serif",
          fontStyle: 'italic', fontWeight: 900, fontSize: 38,
          lineHeight: 1, letterSpacing: -1, marginBottom: 10,
        }}>
          הוסף את כל{' '}
          <span style={{
            background: 'var(--lf-yellow)', padding: '0 10px', borderRadius: 10,
          }}>המועדונים שלך</span>
        </div>
        <p style={{ fontSize: 15, color: 'var(--lf-ink-2)', marginBottom: 14, lineHeight: 1.5 }}>
          בחר/י את כל מה שיש לך — נראה לך את כל ההנחות במקום אחד.
        </p>

        {/* Select all */}
        <button
          className="lf-tap"
          onClick={() => {
            const allSlugs = memberships.map(m => m.slug);
            const allSelected = allSlugs.every(s => selected.includes(s));
            setSelected(allSelected ? [] : allSlugs);
          }}
          style={{
            marginBottom: 14, padding: '8px 16px', borderRadius: 999,
            background: memberships.length > 0 && memberships.every(m => selected.includes(m.slug))
              ? 'var(--lf-ink)' : 'var(--lf-bg-2)',
            color: memberships.length > 0 && memberships.every(m => selected.includes(m.slug))
              ? 'var(--lf-bg)' : 'var(--lf-ink)',
            fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
          {memberships.length > 0 && memberships.every(m => selected.includes(m.slug))
            ? '✓ כל המועדונים נבחרו'
            : '✦ בחר את כולם'}
        </button>

        {/* Search */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: '#fff', borderRadius: 18, padding: '12px 16px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.05)', marginBottom: 4,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="7" stroke="#3E2A5B" strokeWidth="2.2"/>
            <path d="M20 20l-3.5-3.5" stroke="#3E2A5B" strokeWidth="2.2" strokeLinecap="round"/>
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="חפש מועדון..."
            style={{
              border: 'none', outline: 'none', background: 'transparent',
              flex: 1, fontSize: 16, color: 'var(--lf-ink)', fontFamily: 'inherit',
            }}
          />
        </div>
      </div>

      {/* Scrollable list */}
      <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '12px 24px 160px' }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--lf-ink-2)' }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%', margin: '0 auto 12px',
              background: 'linear-gradient(135deg, var(--lf-primary), var(--lf-pink))',
              animation: 'popIn 1.2s cubic-bezier(.34,1.56,.64,1) infinite',
            }}/>
            טוען מועדונים...
          </div>
        ) : (
          <>
            {Object.entries(MEMBERSHIP_CATEGORIES).map(([cat, slugs]) => {
              const items = filtered.filter(m => slugs.includes(m.slug));
              if (items.length === 0) return null;
              return (
                <div key={cat} style={{ marginBottom: 26 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 700, color: 'var(--lf-ink-2)',
                    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14,
                  }}>{cat}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
                    {items.map(m => (
                      <ClubChip
                        key={m.id}
                        membership={m}
                        selected={selected.includes(m.slug)}
                        onToggle={() => toggle(m.slug)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
            {uncategorized.length > 0 && (
              <div style={{ marginBottom: 26 }}>
                <div style={{
                  fontSize: 12, fontWeight: 700, color: 'var(--lf-ink-2)',
                  textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14,
                }}>🏷️ אחר</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
                  {uncategorized.map(m => (
                    <ClubChip
                      key={m.id}
                      membership={m}
                      selected={selected.includes(m.slug)}
                      onToggle={() => toggle(m.slug)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Sticky CTA */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        padding: '16px 24px 32px',
        background: 'linear-gradient(to top, var(--lf-bg) 65%, transparent)',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 12, fontSize: 14, color: 'var(--lf-ink-2)', fontWeight: 600,
        }}>
          {selected.length === 0
            ? <span>לא נבחרו מועדונים עדיין</span>
            : <span>{selected.length} נבחרו</span>
          }
          {selected.length > 0 && (
            <span style={{
              background: 'var(--lf-mint)', color: 'var(--lf-ink)',
              padding: '4px 10px', borderRadius: 999, fontWeight: 800, fontSize: 13,
            }}>
              עד ~{selected.length * 24}₪ לחודש 🔥
            </span>
          )}
        </div>
        <button
          className="lf-tap"
          onClick={() => selected.length > 0 && onComplete(selected)}
          disabled={selected.length === 0}
          style={{
            width: '100%', padding: '18px 26px', borderRadius: 999,
            background: selected.length > 0 ? 'var(--lf-primary)' : 'var(--lf-line)',
            color: selected.length > 0 ? '#fff' : 'rgba(0,0,0,0.3)',
            fontFamily: "'Rubik', sans-serif", fontWeight: 700, fontSize: 18,
            boxShadow: selected.length > 0
              ? '0 4px 0 rgba(0,0,0,0.12), 0 8px 24px rgba(109,40,255,0.2)'
              : 'none',
            border: 'none', cursor: selected.length > 0 ? 'pointer' : 'not-allowed',
            transition: 'all .2s',
          }}>
          המשך ({selected.length}) →
        </button>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
const OnboardingPage = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  const handleComplete = (clubs: string[]) => {
    setSelectedMemberships(clubs);
    setOnboardingComplete(true);
    navigate("/dashboard");
  };

  return (
    <>
      {step === 0 && <WelcomeScreen onNext={() => setStep(1)} />}
      {step === 1 && <ClubsScreen onComplete={handleComplete} />}
    </>
  );
};

export default OnboardingPage;
