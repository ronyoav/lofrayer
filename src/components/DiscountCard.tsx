interface DiscountCardProps {
  discount: any;
}
const DiscountCard = ({ discount }: DiscountCardProps) => {
  return (
    <a
      href={discount.redeem_url || discount.redeemUrl || '#'}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${discount.brand} — ${discount.title} (נפתח בחלון חדש)`}
      className="block rounded-2xl bg-card shadow-card hover:shadow-card-hover transition-all duration-200 overflow-hidden group"
    >
      <div className="p-4 flex items-start gap-4">
        <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-accent flex items-center justify-center overflow-hidden">
          {(discount.brandLogo || discount.brand_logo_url) ? (
            <img
              src={discount.brandLogo || discount.brand_logo_url}
              alt={discount.brand}
              className="w-12 h-12 object-contain"
            />
          ) : (
            <span className="text-xl font-bold text-accent-foreground" aria-hidden="true">
              {discount.brand?.charAt(0) || '?'}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-foreground truncate">
              {discount.brand}
            </h3>
            <span className="flex-shrink-0 mr-2 inline-flex items-center rounded-full bg-savings-light px-3 py-1 text-sm font-bold text-accent-foreground">
              {discount.discountValue || discount.discount_value}
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
