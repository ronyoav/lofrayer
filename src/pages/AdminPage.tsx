import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Plus, Trash2, Edit2, Save, X, Loader2, Camera, LogOut } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useDiscounts, useMemberships } from "@/hooks/useDiscounts";
import { useQueryClient } from "@tanstack/react-query";

const CATEGORIES = [
  "אופנה", "מזון", "בריאות", "בידור", "חשמל",
  "ספורט", "תיירות", "רכב", "ביטוח", "פיננסי", "לימודים", "כללי",
];

type DiscountForm = {
  brand: string;
  title: string;
  description: string;
  discount_value: string;
  category: string;
  location: string;
  redeem_url: string;
  membership_id: string;
};

const emptyForm: DiscountForm = {
  brand: "",
  title: "",
  description: "",
  discount_value: "",
  category: "כללי",
  location: "כל הארץ",
  redeem_url: "",
  membership_id: "",
};

const AdminPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: allMemberships = [] } = useMemberships();
  const [selectedMembership, setSelectedMembership] = useState<string>("");
  const [form, setForm] = useState<DiscountForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Screenshot upload state
  const [screenshotMembership, setScreenshotMembership] = useState<string>("");
  const [screenshotFiles, setScreenshotFiles] = useState<File[]>([]);
  const [isProcessingScreenshots, setIsProcessingScreenshots] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleScreenshotUpload = async () => {
    if (!screenshotMembership || screenshotFiles.length === 0) {
      toast({ title: "שגיאה", description: "בחר מועדון והעלה לפחות תמונה אחת", variant: "destructive" });
      return;
    }
    setIsProcessingScreenshots(true);
    try {
      const toBase64 = (file: File): Promise<string> =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

      const images = await Promise.all(screenshotFiles.map(toBase64));
      const membership = allMemberships.find((m) => m.id === screenshotMembership);

      const { data, error } = await supabase.functions.invoke("process-screenshots", {
        body: {
          images,
          membership_slug: membership?.slug,
          skip_deactivate: false,
        },
      });

      if (error) throw error;

      toast({
        title: "עיבוד הושלם",
        description: `נמצאו ${data?.discountsFound ?? 0} הנחות מ-${screenshotFiles.length} תמונות`,
      });
      setScreenshotFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["discounts"] });
      refetch();
    } catch (err: any) {
      toast({ title: "שגיאה", description: err.message, variant: "destructive" });
    } finally {
      setIsProcessingScreenshots(false);
    }
  };

  // Get all membership slugs for fetching discounts
  const allSlugs = allMemberships.map((m) => m.slug);
  const { data: allDiscounts = [], refetch } = useDiscounts(allSlugs);

  // Filter discounts by selected membership
  const filteredDiscounts = selectedMembership
    ? allDiscounts.filter((d: any) => d.membership?.id === selectedMembership)
    : allDiscounts;

  const handleSave = async () => {
    if (!form.brand || !form.title || !form.discount_value || !form.membership_id) {
      toast({ title: "שגיאה", description: "נא למלא שם מותג, כותרת, ערך הנחה ומועדון", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      if (editingId) {
        const { error } = await supabase
          .from("discounts")
          .update({
            brand: form.brand,
            title: form.title,
            description: form.description || null,
            discount_value: form.discount_value,
            category: form.category,
            location: form.location,
            redeem_url: form.redeem_url || null,
            membership_id: form.membership_id,
          })
          .eq("id", editingId);
        if (error) throw error;
        toast({ title: "עודכן בהצלחה" });
      } else {
        const { error } = await supabase.from("discounts").insert({
          brand: form.brand,
          title: form.title,
          description: form.description || null,
          discount_value: form.discount_value,
          category: form.category,
          location: form.location || "כל הארץ",
          redeem_url: form.redeem_url || null,
          membership_id: form.membership_id,
          is_active: true,
        });
        if (error) throw error;
        toast({ title: "הנחה נוספה בהצלחה" });
      }
      setForm(emptyForm);
      setEditingId(null);
      setIsAdding(false);
      queryClient.invalidateQueries({ queryKey: ["discounts"] });
      refetch();
    } catch (err: any) {
      toast({ title: "שגיאה", description: err.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (discount: any) => {
    setForm({
      brand: discount.brand,
      title: discount.title,
      description: discount.description || "",
      discount_value: discount.discount_value,
      category: discount.category || "כללי",
      location: discount.location || "כל הארץ",
      redeem_url: discount.redeem_url || "",
      membership_id: discount.membership_id,
    });
    setEditingId(discount.id);
    setIsAdding(true);
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const { error } = await supabase.from("discounts").delete().eq("id", id);
      if (error) throw error;
      toast({ title: "הנחה נמחקה" });
      queryClient.invalidateQueries({ queryKey: ["discounts"] });
      refetch();
    } catch (err: any) {
      toast({ title: "שגיאה", description: err.message, variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const handleCancel = () => {
    setForm(emptyForm);
    setEditingId(null);
    setIsAdding(false);
  };

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-primary to-primary/80 text-primary-foreground p-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold">⚙️ ניהול הנחות</h1>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")} className="text-primary-foreground">
              חזרה לדשבורד <ArrowRight className="mr-1 h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut().then(() => navigate("/login"))} className="text-primary-foreground">
              <LogOut className="ml-1 h-4 w-4" /> יציאה
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 space-y-6">
        {/* Filter by membership */}
        <div className="flex items-center gap-3">
          <Select value={selectedMembership} onValueChange={setSelectedMembership}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="כל המועדונים" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל המועדונים</SelectItem>
              {allMemberships.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button onClick={() => { setIsAdding(true); setEditingId(null); setForm(emptyForm); }}>
            <Plus className="ml-1 h-4 w-4" /> הוסף הנחה
          </Button>
        </div>

        {/* Screenshot Upload (for login-protected sites like Isracard) */}
        <div className="rounded-2xl border bg-card p-5 space-y-4 shadow-sm">
          <h2 className="font-bold text-lg flex items-center gap-2">
            <Camera className="h-5 w-5" />
            ייבוא הנחות מצילומי מסך
          </h2>
          <p className="text-sm text-muted-foreground">
            לאתרים שדורשים התחברות (כגון ישראכרט): התחבר לאתר, צלם מסך של דף ההטבות ועלה כאן — ה-AI יחלץ את ההנחות אוטומטית.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">מועדון *</label>
              <Select value={screenshotMembership} onValueChange={setScreenshotMembership}>
                <SelectTrigger>
                  <SelectValue placeholder="בחר מועדון" />
                </SelectTrigger>
                <SelectContent>
                  {allMemberships.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">
                תמונות ({screenshotFiles.length} נבחרו)
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="block w-full text-sm text-muted-foreground file:ml-2 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-medium file:bg-accent file:text-accent-foreground hover:file:bg-accent/80 cursor-pointer"
                onChange={(e) => setScreenshotFiles(Array.from(e.target.files || []))}
              />
            </div>
          </div>
          <Button
            onClick={handleScreenshotUpload}
            disabled={isProcessingScreenshots || !screenshotMembership || screenshotFiles.length === 0}
          >
            {isProcessingScreenshots ? (
              <><Loader2 className="ml-1 h-4 w-4 animate-spin" /> מעבד תמונות...</>
            ) : (
              <><Camera className="ml-1 h-4 w-4" /> עבד {screenshotFiles.length > 0 ? `${screenshotFiles.length} תמונות` : "תמונות"}</>
            )}
          </Button>
        </div>

        {/* Add/Edit Form */}
        {isAdding && (
          <div className="rounded-2xl border bg-card p-5 space-y-4 shadow-sm">
            <h2 className="font-bold text-lg">
              {editingId ? "✏️ עריכת הנחה" : "➕ הנחה חדשה"}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">מועדון *</label>
                <Select value={form.membership_id} onValueChange={(v) => setForm({ ...form, membership_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="בחר מועדון" />
                  </SelectTrigger>
                  <SelectContent>
                    {allMemberships.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">שם מותג *</label>
                <Input
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                  placeholder="לדוגמה: נייקי"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">כותרת ההנחה *</label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="לדוגמה: 20% הנחה על כל הקולקציה"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">ערך ההנחה *</label>
                <Input
                  value={form.discount_value}
                  onChange={(e) => setForm({ ...form, discount_value: e.target.value })}
                  placeholder="לדוגמה: 20%, 1+1, 50₪"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">קטגוריה</label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">מיקום</label>
                <Input
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="כל הארץ"
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-sm font-medium text-muted-foreground mb-1 block">תיאור</label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="תיאור קצר של ההטבה"
                  rows={2}
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-sm font-medium text-muted-foreground mb-1 block">לינק למימוש</label>
                <Input
                  value={form.redeem_url}
                  onChange={(e) => setForm({ ...form, redeem_url: e.target.value })}
                  placeholder="https://..."
                  dir="ltr"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Loader2 className="ml-1 h-4 w-4 animate-spin" /> : <Save className="ml-1 h-4 w-4" />}
                {editingId ? "עדכן" : "שמור"}
              </Button>
              <Button variant="outline" onClick={handleCancel}>
                <X className="ml-1 h-4 w-4" /> ביטול
              </Button>
            </div>
          </div>
        )}

        {/* Discounts Table */}
        <div className="rounded-2xl border bg-card overflow-hidden">
          <div className="p-4 border-b bg-muted/30">
            <p className="text-sm text-muted-foreground">
              {filteredDiscounts.length} הנחות
              {selectedMembership && selectedMembership !== "all" && ` ב${allMemberships.find(m => m.id === selectedMembership)?.name || ""}`}
            </p>
          </div>
          <div className="divide-y">
            {filteredDiscounts.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                אין הנחות להצגה
              </div>
            ) : (
              filteredDiscounts.map((d: any) => (
                <div key={d.id} className="p-4 flex items-center gap-4 hover:bg-muted/20 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">{d.brand}</span>
                      <span className="text-xs bg-savings-light text-accent-foreground px-2 py-0.5 rounded-full font-bold">
                        {d.discount_value}
                      </span>
                      {d.scraped_at && (
                        <span className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded-full">
                          🤖 סרוק
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{d.title}</p>
                    <div className="flex gap-2 text-xs text-muted-foreground mt-1">
                      <span className="bg-secondary px-2 py-0.5 rounded">{d.membershipName || d.membership?.name}</span>
                      <span>{d.category}</span>
                      {d.location && <span>📍 {d.location}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => handleEdit(d)}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(d.id)}
                      disabled={deletingId === d.id}
                      className="text-destructive hover:text-destructive"
                    >
                      {deletingId === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;
