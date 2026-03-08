import nikeLogo from "@/assets/brands/nike.png";
import castroLogo from "@/assets/brands/castro.png";
import superpharmLogo from "@/assets/brands/superpharm.png";
import mcdonaldsLogo from "@/assets/brands/mcdonalds.png";
import golfLogo from "@/assets/brands/golf.png";
import cinemacityLogo from "@/assets/brands/cinemacity.png";
import pizzahutLogo from "@/assets/brands/pizzahut.png";
import aceLogo from "@/assets/brands/ace.png";
import renuarLogo from "@/assets/brands/renuar.png";
import holmesplaceLogo from "@/assets/brands/holmesplace.png";
import foxLogo from "@/assets/brands/fox.png";
import shufersalLogo from "@/assets/brands/shufersal.png";

export type Membership = {
  id: string;
  name: string;
  logo: string;
  color: string;
};

export type Discount = {
  id: string;
  brand: string;
  brandLogo: string;
  title: string;
  description: string;
  discountValue: string;
  membershipId: string;
  membershipName: string;
  category: string;
  location?: string;
  redeemUrl: string;
  expiresAt?: string;
};

export const MEMBERSHIPS: Membership[] = [
  { id: "behatzada", name: "בהצדעה", logo: "🎖️", color: "#2E7D32" },
  { id: "cal", name: "כאל", logo: "💳", color: "#1565C0" },
  { id: "bank-hapoalim", name: "בנק הפועלים", logo: "🏦", color: "#E53935" },
  { id: "histadrut-morim", name: "הסתדרות המורים", logo: "📚", color: "#6A1B9A" },
  { id: "hever", name: "חבר", logo: "🤝", color: "#00838F" },
  { id: "max", name: "מקס", logo: "💳", color: "#FF6F00" },
  { id: "iscard", name: "ישראכרט", logo: "💳", color: "#0D47A1" },
  { id: "clalit", name: "כללית מושלם", logo: "🏥", color: "#43A047" },
  { id: "maccabi", name: "מכבי שירותי בריאות", logo: "🏥", color: "#1976D2" },
  { id: "hofesh", name: "הופש", logo: "🌴", color: "#F57C00" },
];

export const BRAND_LOGOS: Record<string, string> = {
  "נייקי": nikeLogo,
  "קסטרו": castroLogo,
  "סופר-פארם": superpharmLogo,
  "מקדונלד׳ס": mcdonaldsLogo,
  "גולף": golfLogo,
  "סינמה סיטי": cinemacityLogo,
  "פיצה האט": pizzahutLogo,
  "אייס": aceLogo,
  "רנואר": renuarLogo,
  "הולמס פלייס": holmesplaceLogo,
  "FOX": foxLogo,
  "שופרסל": shufersalLogo,
};

export const MOCK_DISCOUNTS: Discount[] = [
  {
    id: "1",
    brand: "נייקי",
    brandLogo: nikeLogo,
    title: "10% הנחה על כל הקולקציה",
    description: "הנחה על כל מוצרי נייקי בחנויות ובאונליין",
    discountValue: "10%",
    membershipId: "behatzada",
    membershipName: "בהצדעה",
    category: "אופנה",
    location: "כל הארץ",
    redeemUrl: "https://behatzada.mod.gov.il",
  },
  {
    id: "2",
    brand: "קסטרו",
    brandLogo: castroLogo,
    title: "15% הנחה לחברי כאל",
    description: "הנחה על קולקציית החורף בכל הסניפים",
    discountValue: "15%",
    membershipId: "cal",
    membershipName: "כאל",
    category: "אופנה",
    location: "תל אביב",
    redeemUrl: "https://www.cal.co.il",
  },
  {
    id: "3",
    brand: "סופר-פארם",
    brandLogo: superpharmLogo,
    title: "20% הנחה על מוצרי טיפוח",
    description: "הנחה על מגוון מוצרי טיפוח נבחרים",
    discountValue: "20%",
    membershipId: "hever",
    membershipName: "חבר",
    category: "בריאות",
    location: "כל הארץ",
    redeemUrl: "https://www.hever.co.il",
  },
  {
    id: "4",
    brand: "מקדונלד׳ס",
    brandLogo: mcdonaldsLogo,
    title: "ארוחה ב-50₪ במקום 70₪",
    description: "ארוחת ביג מק משפחתית בהנחה",
    discountValue: "29%",
    membershipId: "bank-hapoalim",
    membershipName: "בנק הפועלים",
    category: "מזון",
    location: "ירושלים",
    redeemUrl: "https://www.bankhapoalim.co.il",
  },
  {
    id: "5",
    brand: "גולף",
    brandLogo: golfLogo,
    title: "25% הנחה על פריט שני",
    description: "על כל הקולקציה החדשה",
    discountValue: "25%",
    membershipId: "histadrut-morim",
    membershipName: "הסתדרות המורים",
    category: "אופנה",
    location: "חיפה",
    redeemUrl: "https://www.igm.org.il",
  },
  {
    id: "6",
    brand: "סינמה סיטי",
    brandLogo: cinemacityLogo,
    title: "כרטיס קולנוע ב-29.90₪",
    description: "כרטיס מוזל לכל סרט בכל יום",
    discountValue: "29.90₪",
    membershipId: "behatzada",
    membershipName: "בהצדעה",
    category: "בידור",
    location: "כל הארץ",
    redeemUrl: "https://behatzada.mod.gov.il",
  },
  {
    id: "7",
    brand: "פיצה האט",
    brandLogo: pizzahutLogo,
    title: "1+1 על פיצה משפחתית",
    description: "אחד פלוס אחד על כל פיצה משפחתית",
    discountValue: "1+1",
    membershipId: "cal",
    membershipName: "כאל",
    category: "מזון",
    location: "תל אביב",
    redeemUrl: "https://www.cal.co.il",
  },
  {
    id: "8",
    brand: "אייס",
    brandLogo: aceLogo,
    title: "10% הנחה על מוצרי חשמל",
    description: "על מוצרי חשמל נבחרים בלבד",
    discountValue: "10%",
    membershipId: "hever",
    membershipName: "חבר",
    category: "חשמל",
    location: "באר שבע",
    redeemUrl: "https://www.hever.co.il",
  },
  {
    id: "9",
    brand: "רנואר",
    brandLogo: renuarLogo,
    title: "20% הנחה לחברי מקס",
    description: "על כל החנות כולל מבצעים",
    discountValue: "20%",
    membershipId: "max",
    membershipName: "מקס",
    category: "אופנה",
    location: "כל הארץ",
    redeemUrl: "https://www.max.co.il",
  },
  {
    id: "10",
    brand: "הולמס פלייס",
    brandLogo: holmesplaceLogo,
    title: "חודש ראשון חינם",
    description: "הרשמה עם חודש ניסיון חינם",
    discountValue: "חינם",
    membershipId: "clalit",
    membershipName: "כללית מושלם",
    category: "ספורט",
    location: "תל אביב",
    redeemUrl: "https://www.clalit.co.il",
  },
  {
    id: "11",
    brand: "FOX",
    brandLogo: foxLogo,
    title: "30% הנחה על קולקציית קיץ",
    description: "הנחה על כל פריטי הקיץ",
    discountValue: "30%",
    membershipId: "behatzada",
    membershipName: "בהצדעה",
    category: "אופנה",
    location: "כל הארץ",
    redeemUrl: "https://behatzada.mod.gov.il",
  },
  {
    id: "12",
    brand: "שופרסל",
    brandLogo: shufersalLogo,
    title: "5% הנחה על קניה מעל 300₪",
    description: "בכל סניפי שופרסל",
    discountValue: "5%",
    membershipId: "bank-hapoalim",
    membershipName: "בנק הפועלים",
    category: "מזון",
    location: "כל הארץ",
    redeemUrl: "https://www.bankhapoalim.co.il",
  },
];

export const CATEGORIES = ["הכל", "אופנה", "מזון", "בריאות", "בידור", "חשמל", "ספורט"];

export const LOCATIONS = ["כל הארץ", "תל אביב", "ירושלים", "חיפה", "באר שבע"];
