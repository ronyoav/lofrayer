import { useState, useMemo } from "react";
import { MapPin, ChevronLeft, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  setSelectedMemberships,
  setOnboardingComplete,
  setLocationEnabled,
} from "@/lib/storage";
import { useNavigate } from "react-router-dom";
import { useMemberships } from "@/hooks/useDiscounts";

const MEMBERSHIP_CATEGORIES: Record<string, string[]> = {
  "🏦 בנקים": ["bank-hapoalim", "bank-leumi", "bank-discount", "bank-mizrahi", "bank-yahav", "bank-benleumi", "poalim-wonder", "mafteah-discount"],
  "💳 כרטיסי אשראי": ["cal", "max", "iscard", "visa-cal", "isracard-benefits"],
  "🏥 קופות חולים": ["clalit", "maccabi", "leumit", "meuhedet"],
  "🎖️ צבא וביטחון": ["behatzada", "hever", "idf-disabled", "police"],
  "✊ הסתדרויות": ["histadrut", "histadrut-morim", "histadrut-medina", "histadrut-refuit"],
  "📱 תקשורת ואנרגיה": ["hot-club", "partner", "cellcom", "pelephone", "yellow-paz", "sonol"],
  "🛡️ ביטוח": ["migdal", "harel", "menora", "clal-insurance"],
  "🛒 מועדוני צרכנות": ["face", "clubhub", "pais-plus", "hofesh", "rami-levy-club", "shufersal-club"],
  "⚖️ לשכות מקצועיות": ["lishkat-orchei-din", "lishkat-roei-heshbon"],
};

const MEMBERSHIP_EMOJIS: Record<string, string> = {
  // צבא וביטחון
  "behatzada": "🎖️",
  "hever": "🤝",
  "idf-disabled": "🎗️",
  "police": "👮",
  // בנקים
  "bank-hapoalim": "🏦",
  "bank-leumi": "🏦",
  "bank-discount": "🏦",
  "bank-mizrahi": "🏦",
  "bank-yahav": "🏦",
  "bank-benleumi": "🏦",
  "poalim-wonder": "✨",
  "mafteah-discount": "🔑",
  // כרטיסי אשראי
  "cal": "💳",
  "max": "💳",
  "iscard": "💳",
  "visa-cal": "💳",
  "isracard-benefits": "💳",
  // קופות חולים
  "clalit": "🏥",
  "maccabi": "🏥",
  "leumit": "🏥",
  "meuhedet": "🏥",
  // הסתדרויות
  "histadrut": "✊",
  "histadrut-morim": "📚",
  "histadrut-medina": "🏛️",
  "histadrut-refuit": "⚕️",
  // תקשורת ואנרגיה
  "hot-club": "📺",
  "partner": "📱",
  "cellcom": "📱",
  "pelephone": "📱",
  "yellow-paz": "⛽",
  "sonol": "⛽",
  // ביטוח
  "migdal": "🛡️",
  "harel": "🛡️",
  "menora": "🛡️",
  "clal-insurance": "🛡️",
  // מועדוני צרכנות
  "face": "😊",
  "clubhub": "🎯",
  "pais-plus": "🎰",
  "hofesh": "🌴",
  // לשכות
  "lishkat-orchei-din": "⚖️",
  "lishkat-roei-heshbon": "📊",
  // רשתות
  "rami-levy-club": "🛒",
  "shufersal-club": "🛒",
};

const OnboardingPage = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<"location" | "memberships">("location");
  const [selected, setSelected] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const { data: memberships = [], isLoading } = useMemberships();

  const filteredMemberships = useMemo(() => {
    if (!searchQuery) return memberships;
    return memberships.filter((m) =>
      m.name.includes(searchQuery) || m.slug.includes(searchQuery.toLowerCase())
    );
  }, [memberships, searchQuery]);

  const handleLocationPermission = (allow: boolean) => {
    setLocationEnabled(allow);
    if (allow) {
      navigator.geolocation?.getCurrentPosition(() => {}, () => {});
    }
    setStep("memberships");
  };

  const toggleMembership = (slug: string) => {
    setSelected((prev) =>
      prev.includes(slug) ? prev.filter((m) => m !== slug) : [...prev, slug]
    );
  };

  const handleFinish = () => {
    setSelectedMemberships(selected);
    setOnboardingComplete(true);
    navigate("/dashboard");
  };

  if (step === "location") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6 gradient-hero">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-accent">
            <MapPin className="h-12 w-12 text-primary" />
          </div>
          <h1 className="mb-3 text-3xl font-bold text-foreground">שירותי מיקום</h1>
          <p className="mb-8 text-lg text-muted-foreground leading-relaxed">
            נשתמש במיקום שלך כדי למצוא הנחות והטבות בסניפים קרובים אליך
          </p>
          <div className="flex flex-col gap-3">
            <Button
              size="lg"
              className="w-full text-lg h-14 gradient-primary text-primary-foreground"
              onClick={() => handleLocationPermission(true)}
            >
              אישור שימוש במיקום
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="w-full text-lg h-14 text-muted-foreground"
              onClick={() => handleLocationPermission(false)}
            >
              אולי אחר כך
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 py-8 gradient-hero">
      <div className="mx-auto max-w-md">
        <button
          onClick={() => setStep("location")}
          className="mb-4 flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-5 w-5 rotate-180" />
          חזרה
        </button>

        <h1 className="mb-2 text-3xl font-bold text-foreground">
          באילו מנויים את/ה חבר/ה?
        </h1>
        <p className="mb-4 text-muted-foreground text-lg">
          בחר/י את כל המנויים שלך כדי שנמצא לך את כל ההנחות
        </p>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="חפש מנוי..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-10 rounded-xl border-none bg-card pr-10 text-foreground placeholder:text-muted-foreground shadow-card"
          />
        </div>

        {isLoading ? (
          <div className="py-8 text-center">
            <div className="gradient-primary h-10 w-10 mx-auto rounded-full animate-pulse mb-3" />
            <p className="text-muted-foreground">טוען מנויים...</p>
          </div>
        ) : (
          <div className="space-y-6 mb-8 max-h-[55vh] overflow-y-auto">
            {Object.entries(MEMBERSHIP_CATEGORIES).map(([category, slugs]) => {
              const categoryMemberships = filteredMemberships.filter((m) => slugs.includes(m.slug));
              if (categoryMemberships.length === 0) return null;
              return (
                <div key={category}>
                  <p className="text-sm font-semibold text-muted-foreground mb-2">{category}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {categoryMemberships.map((m) => {
                      const isSelected = selected.includes(m.slug);
                      return (
                        <button
                          key={m.slug}
                          onClick={() => toggleMembership(m.slug)}
                          className={`flex items-center gap-2 rounded-xl p-3 text-right transition-all duration-200 ${
                            isSelected
                              ? "bg-accent border-2 border-primary shadow-card"
                              : "bg-card border-2 border-transparent shadow-card hover:shadow-card-hover"
                          }`}
                        >
                          <span className="text-lg">{MEMBERSHIP_EMOJIS[m.slug] || "🏷️"}</span>
                          <span className="text-xs font-medium text-foreground leading-tight">
                            {m.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {/* Show uncategorized memberships */}
            {filteredMemberships
              .filter((m) => !Object.values(MEMBERSHIP_CATEGORIES).flat().includes(m.slug))
              .length > 0 && (
              <div>
                <p className="text-sm font-semibold text-muted-foreground mb-2">🏷️ אחר</p>
                <div className="grid grid-cols-2 gap-2">
                  {filteredMemberships
                    .filter((m) => !Object.values(MEMBERSHIP_CATEGORIES).flat().includes(m.slug))
                    .map((m) => {
                      const isSelected = selected.includes(m.slug);
                      return (
                        <button
                          key={m.slug}
                          onClick={() => toggleMembership(m.slug)}
                          className={`flex items-center gap-2 rounded-xl p-3 text-right transition-all duration-200 ${
                            isSelected
                              ? "bg-accent border-2 border-primary shadow-card"
                              : "bg-card border-2 border-transparent shadow-card hover:shadow-card-hover"
                          }`}
                        >
                          <span className="text-lg">🏷️</span>
                          <span className="text-xs font-medium text-foreground leading-tight">
                            {m.name}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        )}

        <Button
          size="lg"
          className="w-full text-lg h-14 gradient-primary text-primary-foreground"
          onClick={handleFinish}
          disabled={selected.length === 0}
        >
          {selected.length === 0
            ? "בחר/י לפחות מנוי אחד"
            : `המשך עם ${selected.length} מנויים`}
        </Button>
      </div>
    </div>
  );
};

export default OnboardingPage;
