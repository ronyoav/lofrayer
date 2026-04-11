const MEMBERSHIP_EMOJIS: Record<string, string> = {
  "behatzada": "🎖️", "hever": "🤝", "idf-disabled": "🎗️", "police": "👮",
  "bank-hapoalim": "🏦", "bank-leumi": "🏦", "bank-discount": "🏦",
  "bank-mizrahi": "🏦", "bank-yahav": "🏦", "bank-benleumi": "🏦",
  "poalim-wonder": "✨", "poalim-wonder-food": "✨", "poalim-wonder-movies": "✨",
  "mafteah-discount": "🔑",
  "cal": "💳", "max": "💳", "iscard": "💳", "isracard": "💳",
  "visa-cal": "💳", "isracard-benefits": "💳",
  "clalit": "🏥", "maccabi": "🏥", "leumit": "🏥", "meuhedet": "🏥",
  "histadrut": "✊", "histadrut-morim": "📚", "histadrut-medina": "🏛️", "histadrut-refuit": "⚕️",
  "hot-club": "📺", "partner": "📱", "cellcom": "📱", "pelephone": "📱",
  "yellow-paz": "⛽", "sonol": "⛽",
  "migdal": "🛡️", "harel": "🛡️", "menora": "🛡️", "clal-insurance": "🛡️",
  "face": "😊", "clubhub": "🎯", "pais-plus": "🎰", "pais": "🎰", "hofesh": "🌴",
  "yours": "🎁",
  "lishkat-orchei-din": "⚖️", "lishkat-roei-heshbon": "📊",
  "rami-levy-club": "🛒", "shufersal-club": "🛒",
};

interface Discount {
  id: string;
  brand: string;
  brandLogo?: string;
  title: string;
  description?: string;
  discountValue: string;
  membershipId: string;
  membershipName: string;
  membershipLogoUrl?: string | null;
  category: string;
  location?: string;
  redeemUrl: string;
}

interface DiscountCardProps {
  discount: Discount;
}

const DiscountCard = ({ discount }: DiscountCardProps) => {
  const membershipEmoji = MEMBERSHIP_EMOJIS[discount.membershipId] || "🏷️";

  return (
    <a
      href={discount.redeemUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${discount.brand} — ${discount.title} (נפתח בחלון חדש)`}
      className="block rounded-2xl bg-card shadow-card hover:shadow-card-hover transition-all duration-200 overflow-hidden group"
    >
      <div className="p-4 flex items-start gap-4">
        <div className="relative flex-shrink-0">
          <div className="w-14 h-14 rounded-xl bg-accent flex items-center justify-center overflow-hidden">
            {discount.brandLogo ? (
              <img
                src={discount.brandLogo}
                alt={discount.brand}
                className="w-12 h-12 object-contain"
              />
            ) : (
              <span className="text-xl font-bold text-accent-foreground" aria-hidden="true">
                {discount.brand.charAt(0)}
              </span>
            )}
          </div>
          {/* Membership badge — bottom-right corner of brand logo */}
          <div
            className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-card border-2 border-background flex items-center justify-center shadow-sm"
            title={discount.membershipName}
            aria-label={`מנוי: ${discount.membershipName}`}
          >
            {discount.membershipLogoUrl ? (
              <img
                src={discount.membershipLogoUrl}
                alt={discount.membershipName}
                className="w-4 h-4 object-contain rounded-full"
              />
            ) : (
              <span className="text-[10px] leading-none">{membershipEmoji}</span>
            )}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-foreground truncate">
              {discount.brand}
            </h3>
            <span className="flex-shrink-0 mr-2 inline-flex items-center rounded-full bg-savings-light px-3 py-1 text-sm font-bold text-accent-foreground">
              {discount.discountValue}
            </span>
          </div>
          <p className="text-sm text-foreground mb-1 leading-snug">
            {discount.title}
          </p>
          {discount.description && (
            <p className="text-xs text-muted-foreground mb-1 leading-snug">
              {discount.description}
            </p>
          )}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5">
              <span aria-hidden="true">{membershipEmoji}</span>
              {discount.membershipName}
            </span>
            {discount.location && (
              <span className="inline-flex items-center gap-1">
                📍 {discount.location}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="px-4 pb-3">
        <div className="text-xs text-primary font-medium group-hover:underline">
          לחץ למימוש ההטבה ←
        </div>
      </div>
    </a>
  );
};

export default DiscountCard;
