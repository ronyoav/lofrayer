import { useState, useMemo } from "react";
import { Search, MapPin, SlidersHorizontal, LogOut, Settings } from "lucide-react";
import { Input } from "@/components/ui/input";
import { CATEGORIES, LOCATIONS } from "@/data/mockData";
import {
  getSelectedMemberships,
  setOnboardingComplete,
  setSelectedMemberships,
} from "@/lib/storage";
import DiscountCard from "@/components/DiscountCard";
import { useNavigate } from "react-router-dom";
import { useDiscounts } from "@/hooks/useDiscounts";

const hebrewToLatin: Record<string, string> = {
  'א':'a','ב':'b','ג':'g','ד':'d','ה':'h','ו':'v','ז':'z','ח':'kh','ט':'t','י':'i',
  'כ':'k','ך':'k','ל':'l','מ':'m','ם':'m','נ':'n','ן':'n','ס':'s','ע':'a','פ':'p',
  'ף':'f','צ':'ts','ץ':'ts','ק':'k','ר':'r','ש':'sh','ת':'t',
};

function normalizeForSearch(str: string): string {
  return str
    .split('')
    .map((c) => hebrewToLatin[c] ?? c)
    .join('')
    .toLowerCase()
    .replace(/[aeiou]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesSearch(text: string, normalizedQuery: string): boolean {
  return normalizeForSearch(text).includes(normalizedQuery);
}

const DashboardPage = () => {
  const navigate = useNavigate();
  const userMemberships = getSelectedMemberships();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("הכל");
  const [selectedLocation, setSelectedLocation] = useState("כל הארץ");
  const [showFilters, setShowFilters] = useState(false);

  const { data: discounts = [], isLoading } = useDiscounts(userMemberships);

  const filteredDiscounts = useMemo(() => {
    const normalizedSearch = normalizeForSearch(search);
    return discounts.filter((d) => {
      if (search && !matchesSearch(d.brand, normalizedSearch) && !matchesSearch(d.title, normalizedSearch) && !matchesSearch(d.description || '', normalizedSearch))
        return false;
      if (selectedCategory !== "הכל" && d.category !== selectedCategory)
        return false;
      if (
        selectedLocation !== "כל הארץ" &&
        d.location !== selectedLocation &&
        d.location !== "כל הארץ"
      )
        return false;
      return true;
    });
  }, [search, selectedCategory, selectedLocation, discounts]);

  const handleReset = () => {
    setOnboardingComplete(false);
    setSelectedMemberships([]);
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="gradient-primary px-6 pb-6 pt-8 text-primary-foreground">
        <div className="mx-auto max-w-md">
          <div className="flex items-center justify-between mb-4">
            <div>
              <img src="/new_logo.png" alt="LoFrayer" className="h-10 w-auto object-contain" />
              <p className="text-sm opacity-90">
                {filteredDiscounts.length} הנחות זמינות
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => navigate("/admin")}
                className="rounded-full p-2 hover:bg-primary-foreground/10 transition-colors"
                aria-label="ניהול הנחות"
              >
                <Settings className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                onClick={handleReset}
                className="rounded-full p-2 hover:bg-primary-foreground/10 transition-colors"
                aria-label="איפוס הגדרות"
              >
                <LogOut className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <label htmlFor="discount-search" className="sr-only">חפש מותג או הנחה</label>
            <Input
              id="discount-search"
              placeholder="חפש מותג או הנחה..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-12 rounded-xl border-none bg-card pr-10 text-foreground placeholder:text-muted-foreground shadow-card"
            />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-md px-4">
        {/* Filters toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          aria-expanded={showFilters}
          aria-controls="filters-panel"
          className="mt-2 mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          סינון
        </button>

        {showFilters && (
          <div id="filters-panel" className="mb-4 space-y-3 rounded-xl bg-card p-4 shadow-card animate-in slide-in-from-top-2">
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">קטגוריה</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="סינון לפי קטגוריה">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    aria-pressed={selectedCategory === cat}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                      selectedCategory === cat
                        ? "gradient-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground hover:bg-muted"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                <MapPin className="inline h-3 w-3 ml-1" aria-hidden="true" />
                מיקום
              </p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="סינון לפי מיקום">
                {LOCATIONS.map((loc) => (
                  <button
                    key={loc}
                    onClick={() => setSelectedLocation(loc)}
                    aria-pressed={selectedLocation === loc}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                      selectedLocation === loc
                        ? "gradient-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground hover:bg-muted"
                    }`}
                  >
                    {loc}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Discounts list */}
        <div className="space-y-3 pb-8">
          {isLoading ? (
            <div className="py-16 text-center" role="status" aria-label="טוען הנחות">
              <div className="gradient-primary h-10 w-10 mx-auto rounded-full animate-pulse mb-3" aria-hidden="true" />
              <p className="text-muted-foreground">טוען הנחות...</p>
            </div>
          ) : filteredDiscounts.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-4xl mb-3">🔍</p>
              <p className="text-lg font-medium text-muted-foreground">לא נמצאו הנחות</p>
              <p className="text-sm text-muted-foreground">נסה לשנות את החיפוש או הסינון</p>
            </div>
          ) : (
            filteredDiscounts.map((discount) => (
              <DiscountCard
                key={discount.id}
                discount={{
                  id: discount.id,
                  brand: discount.brand,
                  brandLogo: discount.brandLogo || "",
                  title: discount.title,
                  description: discount.description || "",
                  discountValue: discount.discount_value,
                  membershipId: discount.membership?.slug || "",
                  membershipName: discount.membershipName,
                  category: discount.category || "",
                  location: discount.location || undefined,
                  redeemUrl: discount.redeem_url || "#",
                }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
