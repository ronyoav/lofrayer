import { useState, useMemo } from "react";
import { MEMBERSHIP_LOGOS } from "@/data/mockData";
import {
  getSelectedMemberships,
  setOnboardingComplete,
  setSelectedMemberships,
} from "@/lib/storage";
import DiscountCard from "@/components/DiscountCard";
import { useNavigate } from "react-router-dom";
import { useAllDiscounts, useMemberships, type DiscountResult } from "@/hooks/useDiscounts";

// ── Search helpers ────────────────────────────────────────────────────────────
const hebrewToLatin: Record<string, string> = {
  'א':'a','ב':'b','ג':'g','ד':'d','ה':'h','ו':'v','ז':'z','ח':'kh','ט':'t','י':'i',
  'כ':'k','ך':'k','ל':'l','מ':'m','ם':'m','נ':'n','ן':'n','ס':'s','ע':'a','פ':'p',
  'ף':'f','צ':'ts','ץ':'ts','ק':'k','ר':'r','ש':'sh','ת':'t',
};

function normalizeForSearch(str: string) {
  return str.split('').map(c => hebrewToLatin[c] ?? c).join('')
    .toLowerCase().replace(/[aeiou]/g, '').replace(/\s+/g, ' ').trim();
}

function matchesSearch(text: string, q: string) {
  return normalizeForSearch(text).includes(q);
}

// ── Category meta ─────────────────────────────────────────────────────────────
const CATEGORY_ICONS: Record<string, string> = {
  "בידור": "🎬", "פנאי ומשפחה": "🎡", "אופנה": "👗", "מזון": "🍔",
  "בריאות": "🏥", "קניות": "🛍️", "קניות אונליין": "🛒", "שוברים": "🎁", "כללי": "📋",
};

const CATEGORY_COLORS: Record<string, string> = {
  "בידור": "#FF4D8F", "פנאי ומשפחה": "#A47BFF", "אופנה": "#FF3D9A",
  "מזון": "#FFD23F", "בריאות": "#35D6A4", "קניות": "#6D28FF",
  "קניות אונליין": "#FF7A4D", "שוברים": "#FF4D8F", "כללי": "#6D28FF",
};

const CATEGORY_ORDER = ["בידור","פנאי ומשפחה","אופנה","מזון","בריאות","קניות","קניות אונליין","שוברים","כללי"];

const MEMBERSHIP_EMOJIS: Record<string, string> = {
  "behatzada":"🎖️","hever":"🤝","idf-disabled":"🎗️","police":"👮",
  "bank-hapoalim":"🏦","bank-leumi":"🏦","bank-discount":"🏦",
  "bank-mizrahi":"🏦","bank-yahav":"🏦","bank-benleumi":"🏦",
  "poalim-wonder":"✨","mafteah-discount":"🔑",
  "cal":"💳","max":"💳","iscard":"💳","visa-cal":"💳","isracard-benefits":"💳",
  "clalit":"🏥","maccabi":"🏥","leumit":"🏥","meuhedet":"🏥",
  "histadrut":"✊","histadrut-morim":"📚","histadrut-medina":"🏛️","histadrut-refuit":"⚕️",
  "hot-club":"📺","partner":"📱","cellcom":"📱","pelephone":"📱",
  "yellow-paz":"⛽","sonol":"⛽",
  "migdal":"🛡️","harel":"🛡️","menora":"🛡️","clal-insurance":"🛡️",
  "face":"😊","clubhub":"🎯","pais-plus":"🎰","pais":"🎰","hofesh":"🌴",
  "lishkat-orchei-din":"⚖️","lishkat-roei-heshbon":"📊",
  "rami-levy-club":"🛒","shufersal-club":"🛒",
};

const MEMBERSHIP_CARD_COLORS: Record<string, [string, string]> = {
  "cal": ["#1A4CAD","#2B64D4"], "max": ["#00C2A8","#00A890"],
  "isracard": ["#E30613","#B00010"], "isracard-benefits": ["#E30613","#B00010"],
  "visa-cal": ["#1B5E9F","#0A4A7B"], "iscard": ["#E30613","#B00010"],
  "bank-hapoalim": ["#E2231A","#B81710"], "bank-leumi": ["#0A4A7B","#073A62"],
  "bank-discount": ["#00843D","#006B30"], "bank-mizrahi": ["#003E7E","#002F60"],
  "poalim-wonder": ["#FF6B35","#E2231A"],
  "hever": ["#C4122E","#9E0E24"], "histadrut": ["#D8232A","#B01C20"],
  "clalit": ["#0065A8","#004F83"], "maccabi": ["#FFB700","#D99B00"],
  "leumit": ["#005BAA","#004488"], "meuhedet": ["#E63434","#B82828"],
  "pais": ["#E4002B","#B50022"], "pais-plus": ["#E4002B","#B50022"],
  "hot-club": ["#FF0000","#CC0000"],
};

function getMembershipColors(slug: string): [string, string] {
  return MEMBERSHIP_CARD_COLORS[slug] ?? ["#6D28FF","#A47BFF"];
}

// ── Tab bar ───────────────────────────────────────────────────────────────────
type Tab = 'home' | 'search' | 'wallet' | 'me';

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'home', label: 'בית', icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1v-9z"
          stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"/>
      </svg>
    )},
    { id: 'search', label: 'חיפוש', icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2.2"/>
        <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
      </svg>
    )},
    { id: 'wallet', label: 'ארנק', icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <rect x="2.5" y="6" width="19" height="14" rx="3" stroke="currentColor" strokeWidth="2.2"/>
        <path d="M16 13h3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
        <path d="M5 6V4.5a1.5 1.5 0 011.5-1.5H17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
      </svg>
    )},
    { id: 'me', label: 'אני', icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2.2"/>
        <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
      </svg>
    )},
  ];

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
      padding: '10px 16px 24px',
      background: 'linear-gradient(to top, var(--lf-bg) 70%, transparent)',
    }}>
      <div style={{
        background: 'var(--lf-ink)', borderRadius: 999,
        display: 'flex', alignItems: 'center',
        padding: 6, boxShadow: '0 8px 30px rgba(27,16,51,0.28)',
        maxWidth: 460, margin: '0 auto',
      }}>
        {tabs.map(t => {
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              className="lf-tap"
              onClick={() => onChange(t.id)}
              style={{
                flex: isActive ? 1.8 : 1,
                padding: '10px 10px', borderRadius: 999,
                background: isActive ? 'var(--lf-yellow)' : 'transparent',
                color: isActive ? 'var(--lf-ink)' : 'rgba(255,255,255,0.7)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                transition: 'all .25s cubic-bezier(.22,1,.36,1)',
                fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer',
              }}>
              {t.icon}
              {isActive && <span style={{ whiteSpace: 'nowrap' }}>{t.label}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Home tab ──────────────────────────────────────────────────────────────────
function HomeTab({
  discounts, isLoading, userMemberships, onGoSearch, onGoWallet,
}: {
  discounts: DiscountResult[];
  isLoading: boolean;
  userMemberships: string[];
  onGoSearch: () => void;
  onGoWallet: () => void;
}) {
  const [selectedCat, setSelectedCat] = useState("הכל");
  const { data: allMemberships = [] } = useMemberships();
  const myMemberships = allMemberships.filter(m => userMemberships.includes(m.slug));

  const uniqueMembershipsCount = useMemo(() => {
    const slugs = new Set((discounts || []).map(d => d.membership?.slug).filter(Boolean));
    return slugs.size;
  }, [discounts]);

  const filtered = useMemo(() => {
    if (selectedCat === "הכל") return (discounts || []);
    return (discounts || []).filter(d => d.category === selectedCat);
  }, [discounts, selectedCat]);

  const grouped = useMemo(() => {
    const groups: Record<string, typeof filtered> = {};
    filtered.forEach(d => {
      const cat = d.category || "כללי";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(d);
    });
    const orderedCats = CATEGORY_ORDER.filter(c => groups[c]?.length > 0);
    const extra = Object.keys(groups).filter(c => !CATEGORY_ORDER.includes(c));
    return [...orderedCats, ...extra].map(cat => ({ cat, items: groups[cat] }));
  }, [filtered]);

  const allCategories = useMemo(() => {
    const cats = new Set((discounts || []).map(d => d.category).filter(Boolean));
    return ["הכל", ...CATEGORY_ORDER.filter(c => cats.has(c)), ...[...cats].filter(c => !CATEGORY_ORDER.includes(c || ''))];
  }, [discounts]);

  return (
    <div style={{ paddingBottom: 100 }}>
      {/* Header */}
      <div style={{
        padding: '20px 20px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--lf-ink-2)', fontWeight: 600 }}>שלום 👋</div>
          <div style={{
            fontFamily: "'Fraunces', Georgia, serif",
            fontStyle: 'italic', fontWeight: 900, fontSize: 28,
            lineHeight: 1, marginTop: 2, letterSpacing: -1,
          }}>מה קונים היום?</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onGoWallet}
            className="lf-tap"
            style={{
              width: 44, height: 44, borderRadius: '50%',
              background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)', border: 'none', cursor: 'pointer',
            }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect x="2.5" y="6" width="19" height="14" rx="3" stroke="var(--lf-ink)" strokeWidth="2.2"/>
              <path d="M16 13h3" stroke="var(--lf-ink)" strokeWidth="2.2" strokeLinecap="round"/>
              <path d="M5 6V4.5a1.5 1.5 0 011.5-1.5H17" stroke="var(--lf-ink)" strokeWidth="2.2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div style={{ padding: '0 20px 18px' }}>
        <button
          className="lf-tap"
          onClick={onGoSearch}
          style={{
            width: '100%', background: '#fff', borderRadius: 20,
            padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12,
            boxShadow: '0 2px 10px rgba(0,0,0,0.04)', textAlign: 'right',
            border: 'none', cursor: 'pointer',
          }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="7" stroke="var(--lf-ink-2)" strokeWidth="2.2"/>
            <path d="M20 20l-3.5-3.5" stroke="var(--lf-ink-2)" strokeWidth="2.2" strokeLinecap="round"/>
          </svg>
          <span style={{ flex: 1, color: 'var(--lf-ink-2)', fontSize: 16 }}>חפש חנות או מוצר...</span>
        </button>
      </div>

      {/* Savings hero card */}
      <div style={{ padding: '0 20px 20px' }}>
        <div style={{
          background: 'linear-gradient(135deg, var(--lf-primary) 0%, var(--lf-pink) 100%)',
          borderRadius: 28, padding: '22px 24px', color: '#fff',
          position: 'relative', overflow: 'hidden',
          boxShadow: '0 10px 30px rgba(109,40,255,0.25)',
        }}>
          <div style={{
            position: 'absolute', top: -20, left: -20, width: 140, height: 140,
            borderRadius: '50%', background: 'var(--lf-yellow)', opacity: 0.35,
            filter: 'blur(20px)',
          }}/>
          <div style={{
            position: 'absolute', bottom: -30, right: -10, width: 100, height: 100,
            borderRadius: '50%', background: 'var(--lf-coral)', opacity: 0.5,
            filter: 'blur(18px)',
          }}/>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.9 }}>
              כל ההנחות
            </div>
            <div style={{
              fontFamily: "'Fraunces', Georgia, serif",
              fontStyle: 'italic', fontWeight: 900, fontSize: 52,
              lineHeight: 1, letterSpacing: -2, marginTop: 4,
            }}>
              {isLoading ? '...' : (discounts?.length ?? 0)}
            </div>
            <div style={{ fontSize: 14, opacity: 0.85, marginTop: 2 }}>
              הטבות מ-{isLoading ? '...' : uniqueMembershipsCount} מועדונים
            </div>
            {myMemberships.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <span style={{
                  background: 'rgba(255,255,255,0.22)', backdropFilter: 'blur(10px)',
                  padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}>
                  ✨ {myMemberships.length} מועדונים שלך
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* My memberships strip */}
      {myMemberships.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '0 20px 10px',
          }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>המועדונים שלי</div>
            <button
              className="lf-tap"
              onClick={onGoWallet}
              style={{
                fontSize: 13, color: 'var(--lf-primary)', fontWeight: 700,
                background: 'none', border: 'none', cursor: 'pointer',
              }}>
              הכל ←
            </button>
          </div>
          <div className="no-scrollbar" style={{
            display: 'flex', gap: 14, padding: '0 20px', overflowX: 'auto',
          }}>
            {myMemberships.map(m => {
              const logo = MEMBERSHIP_LOGOS[m.slug];
              const emoji = MEMBERSHIP_EMOJIS[m.slug] || "🏷️";
              return (
                <div key={m.id} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  gap: 6, flexShrink: 0, width: 62,
                }}>
                  <div style={{
                    width: 52, height: 52, borderRadius: '50%',
                    background: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 3px 10px rgba(0,0,0,0.1)', overflow: 'hidden',
                  }}>
                    {logo
                      ? <img src={logo} alt={m.name} style={{ width: 36, height: 36, objectFit: 'contain' }}/>
                      : <span style={{ fontSize: 22 }}>{emoji}</span>
                    }
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 600, textAlign: 'center', lineHeight: 1.2 }}>{m.name}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Category filter chips */}
      <div style={{ marginBottom: 20 }}>
        <div className="no-scrollbar" style={{
          display: 'flex', gap: 10, padding: '0 20px', overflowX: 'auto',
        }}>
          {allCategories.map(cat => (
            <button
              key={cat}
              className="lf-tap"
              onClick={() => setSelectedCat(cat)}
              style={{
                flexShrink: 0, padding: '10px 16px', borderRadius: 999,
                background: selectedCat === cat ? 'var(--lf-ink)' : '#fff',
                color: selectedCat === cat ? 'var(--lf-bg)' : 'var(--lf-ink)',
                display: 'flex', alignItems: 'center', gap: 6,
                boxShadow: selectedCat === cat ? 'none' : '0 2px 6px rgba(0,0,0,0.04)',
                fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer',
                transition: 'all .2s',
              }}>
              {cat !== "הכל" && <span style={{ fontSize: 16 }}>{CATEGORY_ICONS[cat] || "🏷️"}</span>}
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Discount list */}
      <div style={{ padding: '0 20px' }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--lf-ink-2)' }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%', margin: '0 auto 12px',
              background: 'linear-gradient(135deg, var(--lf-primary), var(--lf-pink))',
              animation: 'popIn 1.2s cubic-bezier(.34,1.56,.64,1) infinite',
            }}/>
            <p style={{ fontWeight: 500 }}>טוען הנחות...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--lf-ink-2)' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
            <p style={{ fontWeight: 600, fontSize: 16 }}>לא נמצאו הנחות</p>
          </div>
        ) : (
          grouped.map(({ cat, items }) => (
            <div key={cat} style={{ marginBottom: 28 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                marginBottom: 12,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 10,
                  background: CATEGORY_COLORS[cat] || 'var(--lf-primary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16,
                }}>{CATEGORY_ICONS[cat] || "🏷️"}</div>
                <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>{cat}</h2>
                <span style={{ fontSize: 12, color: 'var(--lf-ink-2)', fontWeight: 600 }}>
                  ({items.length})
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {items.map(d => (
                  <DiscountCard
                    key={d.id}
                    discount={{
                      id: d.id,
                      brand: d.brand,
                      brandLogo: d.brandLogo || "",
                      title: d.title,
                      description: d.description || "",
                      discountValue: d.discount_value,
                      membershipId: d.membership?.slug || "",
                      membershipName: d.membershipName,
                      membershipLogoUrl: d.membershipLogoUrl,
                      category: d.category || "",
                      location: d.location || undefined,
                      redeemUrl: d.redeem_url || "#",
                    }}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Search tab ────────────────────────────────────────────────────────────────
function SearchTab({
  discounts, isLoading, onClose,
}: {
  discounts: DiscountResult[];
  isLoading: boolean;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const nq = normalizeForSearch(q);
    return (discounts || []).filter(d =>
      (!q || matchesSearch(d.brand, nq) || matchesSearch(d.title, nq) || matchesSearch(d.description || '', nq)) &&
      (!cat || d.category === cat)
    );
  }, [discounts, q, cat]);

  const allCats = useMemo(() => {
    const s = new Set((discounts || []).map(d => d.category).filter(Boolean));
    return ["אופנה","מזון","בריאות","בידור","קניות","קניות אונליין","פנאי ומשפחה","שוברים","כללי"].filter(c => s.has(c));
  }, [discounts]);

  const trending = ["פיצה", "קפה", "סרטים", "ספורט", "קוסמטיקה"];

  return (
    <div style={{ paddingBottom: 100 }}>
      {/* Search header */}
      <div style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onClose} className="lf-tap" style={{
            padding: 4, background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--lf-ink)',
          }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div style={{
            flex: 1, background: '#fff', borderRadius: 18,
            padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
            boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="var(--lf-ink-2)" strokeWidth="2.2"/>
              <path d="M20 20l-3.5-3.5" stroke="var(--lf-ink-2)" strokeWidth="2.2" strokeLinecap="round"/>
            </svg>
            <input
              autoFocus value={q} onChange={e => setQ(e.target.value)}
              placeholder="חפש חנות, מוצר..."
              style={{
                border: 'none', outline: 'none', background: 'transparent',
                flex: 1, fontSize: 16, fontWeight: 500, color: 'var(--lf-ink)',
                fontFamily: 'inherit',
              }}
            />
            {q && (
              <button className="lf-tap" onClick={() => setQ('')} style={{
                background: 'none', border: 'none', cursor: 'pointer',
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M6 6l12 12M18 6L6 18" stroke="var(--lf-ink-2)" strokeWidth="2.4" strokeLinecap="round"/>
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Category filter chips */}
        <div className="no-scrollbar" style={{
          display: 'flex', gap: 8, overflowX: 'auto', marginTop: 14,
        }}>
          <button className="lf-tap" onClick={() => setCat(null)} style={{
            padding: '8px 14px', borderRadius: 999, flexShrink: 0,
            background: !cat ? 'var(--lf-ink)' : '#fff',
            color: !cat ? 'var(--lf-bg)' : 'var(--lf-ink)',
            fontWeight: 700, fontSize: 13,
            border: 'none', cursor: 'pointer',
            boxShadow: !cat ? 'none' : '0 1px 4px rgba(0,0,0,0.06)',
          }}>הכל</button>
          {allCats.map(c => (
            <button key={c} className="lf-tap" onClick={() => setCat(c === cat ? null : c)} style={{
              padding: '8px 14px', borderRadius: 999, flexShrink: 0,
              background: c === cat ? 'var(--lf-ink)' : '#fff',
              color: c === cat ? 'var(--lf-bg)' : 'var(--lf-ink)',
              fontWeight: 700, fontSize: 13,
              border: 'none', cursor: 'pointer',
              boxShadow: c === cat ? 'none' : '0 1px 4px rgba(0,0,0,0.06)',
            }}>
              {CATEGORY_ICONS[c] || "🏷️"} {c}
            </button>
          ))}
        </div>

      </div>

      {/* Trending */}
      {!q && !cat && (
        <div style={{ padding: '0 20px 20px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--lf-ink-2)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>טרנדים</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {trending.map(t => (
              <button key={t} className="lf-tap" onClick={() => setQ(t)} style={{
                padding: '8px 14px', borderRadius: 999, background: 'var(--lf-yellow)',
                fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                🔥 {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--lf-ink-2)' }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%', margin: '0 auto 12px',
              background: 'linear-gradient(135deg, var(--lf-primary), var(--lf-pink))',
              animation: 'popIn 1.2s cubic-bezier(.34,1.56,.64,1) infinite',
            }}/>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--lf-ink-2)' }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>🔍</div>
            <div style={{ fontWeight: 600 }}>לא מצאנו התאמות</div>
          </div>
        ) : (
          filtered.map(d => (
            <DiscountCard
              key={d.id}
              discount={{
                id: d.id,
                brand: d.brand,
                brandLogo: d.brandLogo || "",
                title: d.title,
                description: d.description || "",
                discountValue: d.discount_value,
                membershipId: d.membership?.slug || "",
                membershipName: d.membershipName,
                membershipLogoUrl: d.membershipLogoUrl,
                category: d.category || "",
                location: d.location || undefined,
                redeemUrl: d.redeem_url || "#",
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Wallet tab ────────────────────────────────────────────────────────────────
function WalletTab({
  userMemberships, discountCount, onAddMore,
}: {
  userMemberships: string[];
  discountCount: number;
  onAddMore: () => void;
}) {
  const { data: allMemberships = [] } = useMemberships();
  const myMemberships = allMemberships.filter(m => userMemberships.includes(m.slug));

  return (
    <div style={{ paddingBottom: 100 }}>
      <div style={{ padding: '20px 20px 14px' }}>
        <div style={{
          fontFamily: "'Fraunces', Georgia, serif",
          fontStyle: 'italic', fontWeight: 900, fontSize: 38,
          lineHeight: 1, letterSpacing: -1,
        }}>הארנק שלי</div>
        <div style={{ fontSize: 14, color: 'var(--lf-ink-2)', marginTop: 4 }}>
          {myMemberships.length} מועדונים · {discountCount} הטבות זמינות
        </div>
      </div>

      <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {myMemberships.map((m, i) => {
          const [c1, c2] = getMembershipColors(m.slug);
          const logo = MEMBERSHIP_LOGOS[m.slug];
          const emoji = MEMBERSHIP_EMOJIS[m.slug] || "🏷️";
          return (
            <div key={m.id} style={{
              borderRadius: 22, padding: '20px 22px',
              background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`,
              color: '#fff', boxShadow: `0 6px 20px ${c1}44`,
              position: 'relative', overflow: 'hidden',
              transform: `rotate(${i % 2 ? 0.4 : -0.4}deg)`,
            }}>
              <div style={{
                position: 'absolute', top: -40, left: -40,
                width: 160, height: 160, borderRadius: '50%',
                background: 'rgba(255,255,255,0.1)',
              }}/>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'flex-start', position: 'relative',
              }}>
                <div>
                  <div style={{
                    fontSize: 10, fontWeight: 700, opacity: 0.8,
                    letterSpacing: 1, textTransform: 'uppercase',
                  }}>{m.slug.includes('bank') ? 'בנק' : m.slug.includes('histadrut') ? 'הסתדרות' : 'מועדון'}</div>
                  <div style={{
                    fontFamily: "'Fraunces', Georgia, serif",
                    fontStyle: 'italic', fontWeight: 900, fontSize: 26,
                    lineHeight: 1, marginTop: 4,
                  }}>{m.name}</div>
                  <div style={{
                    fontFamily: 'monospace', fontSize: 13, marginTop: 14,
                    letterSpacing: 3, opacity: 0.85,
                  }}>•••• •••• ••••</div>
                </div>
                <div style={{
                  width: 52, height: 52, borderRadius: 12,
                  background: 'rgba(255,255,255,0.25)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden',
                }}>
                  {logo
                    ? <img src={logo} alt={m.name} style={{ width: 40, height: 40, objectFit: 'contain', filter: 'brightness(0) invert(1)' }}/>
                    : <span style={{ fontSize: 26 }}>{emoji}</span>
                  }
                </div>
              </div>
            </div>
          );
        })}

        <button
          className="lf-tap"
          onClick={onAddMore}
          style={{
            border: '2px dashed var(--lf-line)', borderRadius: 22, padding: 20,
            background: 'transparent', color: 'var(--lf-ink-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            fontWeight: 700, fontSize: 15, cursor: 'pointer', width: '100%',
          }}>
          <span style={{ fontSize: 22 }}>+</span> הוסף מועדון
        </button>
      </div>
    </div>
  );
}

// ── Me tab ────────────────────────────────────────────────────────────────────
function MeTab({
  userMemberships, discountCount, onReset, onAdmin,
}: {
  userMemberships: string[];
  discountCount: number;
  onReset: () => void;
  onAdmin: () => void;
}) {
  const items = [
    { emoji: '💳', label: 'המועדונים שלי', detail: `${userMemberships.length}`, action: undefined },
    { emoji: '🎯', label: 'הטבות זמינות', detail: `${discountCount}`, action: undefined },
    { emoji: '⚙️', label: 'ניהול הנחות', detail: '', action: onAdmin },
    { emoji: '🔄', label: 'שנה מועדונים', detail: '', action: onReset },
  ];

  return (
    <div style={{ paddingBottom: 100 }}>
      <div style={{ padding: '24px 20px', textAlign: 'center' }}>
        <div style={{
          width: 96, height: 96, margin: '0 auto 12px', borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--lf-primary), var(--lf-pink))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 48,
          boxShadow: '0 8px 24px rgba(109,40,255,0.3)',
        }}>👤</div>
        <div style={{
          fontFamily: "'Fraunces', Georgia, serif",
          fontStyle: 'italic', fontWeight: 900, fontSize: 32,
          lineHeight: 1, letterSpacing: -1,
        }}>lofrayer</div>
        <div style={{ fontSize: 14, color: 'var(--lf-ink-2)', marginTop: 4 }}>
          {userMemberships.length} מועדונים · {discountCount} הטבות
        </div>
      </div>

      <div style={{ padding: '0 20px' }}>
        <div style={{
          background: '#fff', borderRadius: 22, overflow: 'hidden',
          boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
        }}>
          {items.map((it, i) => (
            <button
              key={i}
              className="lf-tap"
              onClick={it.action}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 16px', textAlign: 'right', background: 'transparent',
                borderBottom: i < items.length - 1 ? '1px solid var(--lf-line)' : 'none',
                border: 'none', cursor: it.action ? 'pointer' : 'default',
              }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: 'var(--lf-bg-2)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 20,
              }}>{it.emoji}</div>
              <div style={{ flex: 1, fontWeight: 600, fontSize: 15 }}>{it.label}</div>
              {it.detail && <div style={{ fontSize: 13, color: 'var(--lf-ink-2)', fontWeight: 600 }}>{it.detail}</div>}
              {it.action && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M15 5l-7 7 7 7" stroke="var(--lf-ink-2)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────
const DashboardPage = () => {
  const navigate = useNavigate();
  const userMemberships = getSelectedMemberships();
  const [tab, setTab] = useState<Tab>('home');

  const { data: discounts = [], isLoading } = useAllDiscounts();

  // Count discounts matching user's own memberships (for wallet/me tab display)
  const userDiscountCount = useMemo(() => {
    if (userMemberships.length === 0) return discounts.length;
    return discounts.filter(d => {
      const rawSlug = d.membership?.slug || '';
      const slug = rawSlug.startsWith('poalim-wonder') ? 'poalim-wonder' : rawSlug;
      return userMemberships.includes(slug) || userMemberships.includes(rawSlug);
    }).length;
  }, [discounts, userMemberships]);

  const handleReset = () => {
    setOnboardingComplete(false);
    setSelectedMemberships([]);
    navigate("/onboarding");
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--lf-bg)' }}>
      {/* Logo strip */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 40,
        background: 'var(--lf-bg)',
        padding: '10px 20px 8px',
        borderBottom: '1px solid var(--lf-line)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          fontFamily: "'Rubik', sans-serif",
          fontWeight: 900, fontSize: 26,
          letterSpacing: -1,
          background: 'linear-gradient(120deg, var(--lf-primary) 0%, var(--lf-pink) 100%)',
          WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
        }}>lofrayer</div>
      </div>

      {/* Tab content */}
      {tab === 'home' && (
        <HomeTab
          discounts={discounts}
          isLoading={isLoading}
          userMemberships={userMemberships}
          onGoSearch={() => setTab('search')}
          onGoWallet={() => setTab('wallet')}
        />
      )}
      {tab === 'search' && (
        <SearchTab
          discounts={discounts}
          isLoading={isLoading}
          onClose={() => setTab('home')}
        />
      )}
      {tab === 'wallet' && (
        <WalletTab
          userMemberships={userMemberships}
          discountCount={userDiscountCount}
          onAddMore={handleReset}
        />
      )}
      {tab === 'me' && (
        <MeTab
          userMemberships={userMemberships}
          discountCount={userDiscountCount}
          onReset={handleReset}
          onAdmin={() => navigate('/admin')}
        />
      )}

      <TabBar active={tab} onChange={setTab} />
    </div>
  );
};

export default DashboardPage;
