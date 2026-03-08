import { useState } from "react";
import { MapPin, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MEMBERSHIPS } from "@/data/mockData";
import {
  setSelectedMemberships,
  setOnboardingComplete,
  setLocationEnabled,
} from "@/lib/storage";
import { useNavigate } from "react-router-dom";

const OnboardingPage = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<"location" | "memberships">("location");
  const [selected, setSelected] = useState<string[]>([]);

  const handleLocationPermission = (allow: boolean) => {
    setLocationEnabled(allow);
    if (allow) {
      navigator.geolocation?.getCurrentPosition(() => {}, () => {});
    }
    setStep("memberships");
  };

  const toggleMembership = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
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
          <h1 className="mb-3 text-3xl font-bold text-foreground">
            שירותי מיקום
          </h1>
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
        <p className="mb-8 text-muted-foreground text-lg">
          בחר/י את כל המנויים שלך כדי שנמצא לך את כל ההנחות
        </p>

        <div className="grid grid-cols-2 gap-3 mb-8">
          {MEMBERSHIPS.map((m) => {
            const isSelected = selected.includes(m.id);
            return (
              <button
                key={m.id}
                onClick={() => toggleMembership(m.id)}
                className={`flex items-center gap-3 rounded-xl p-4 text-right transition-all duration-200 ${
                  isSelected
                    ? "bg-accent border-2 border-primary shadow-card"
                    : "bg-card border-2 border-transparent shadow-card hover:shadow-card-hover"
                }`}
              >
                <span className="text-2xl">{m.logo}</span>
                <span className="text-sm font-medium text-foreground leading-tight">
                  {m.name}
                </span>
              </button>
            );
          })}
        </div>

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
