import { Discount } from "@/data/mockData";

interface DiscountCardProps {
  discount: Discount;
}

const DiscountCard = ({ discount }: DiscountCardProps) => {
  return (
    <a
      href={discount.redeemUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-2xl bg-card shadow-card hover:shadow-card-hover transition-all duration-200 overflow-hidden group"
    >
      <div className="p-4 flex items-start gap-4">
        <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-accent flex items-center justify-center overflow-hidden">
          <img
            src={discount.brandLogo}
            alt={discount.brand}
            className="w-12 h-12 object-contain"
          />
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
