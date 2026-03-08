import { useState, useMemo } from "react";
import { Search, MapPin, SlidersHorizontal, LogOut, RefreshCw } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const DashboardPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const userMemberships = getSelectedMemberships();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("הכל");
  const [selectedLocation, setSelectedLocation] = useState("כל הארץ");
  const [showFilters, setShowFilters] = useState(false);
  const [isScraping, setIsScraping] = useState(false);

  const { data: discounts = [], isLoading, refetch } = useDiscounts(userMemberships);

  const filteredDiscounts = useMemo(() => {
    return discounts.filter((d) => {
      if (search && !d.brand.includes(search) && !d.title.includes(search))
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

  const handleScrape = async () => {
    setIsScraping(true);
    try {
      const { data, error } = await supabase.functions.invoke('scrape-discounts');
      if (error) throw error;
      toast({ title: "עדכון הנחות", description: "ההנחות עודכנו בהצלחה!" });
      refetch();
    } catch (err) {
      toast({ title: "שגיאה", description: "נכשל בעדכון הנחות", variant: "destructive" });
    } finally {
      setIsScraping(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="gradient-primary px-6 pb-6 pt-8 text-primary-foreground">
        <div className="mx-auto max-w-md">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold">LoFrayer</h1>
              <p className="text-sm opacity-90">
                {filteredDiscounts.length} הנחות זמינות
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleScrape}
                disabled={isScraping}
                className="rounded-full p-2 hover:bg-primary-foreground/10 transition-colors disabled:opacity-50"
                title="עדכן הנחות"
              >
                <RefreshCw className={`h-5 w-5 ${isScraping ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={handleReset}
                className="rounded-full p-2 hover:bg-primary-foreground/10 transition-colors"
                title="איפוס הגדרות"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
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
          className="mt-4 mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <SlidersHorizontal className="h-4 w-4" />
          סינון
        </button>

        {showFilters && (
          <div className="mb-4 space-y-3 rounded-xl bg-card p-4 shadow-card animate-in slide-in-from-top-2">
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">קטגוריה</p>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
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
                <MapPin className="inline h-3 w-3 ml-1" />
                מיקום
              </p>
              <div className="flex flex-wrap gap-2">
                {LOCATIONS.map((loc) => (
                  <button
                    key={loc}
                    onClick={() => setSelectedLocation(loc)}
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
            <div className="py-16 text-center">
              <div className="gradient-primary h-10 w-10 mx-auto rounded-full animate-pulse mb-3" />
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
