function sanitizeTextMessage(text) {
  if (!text || typeof text !== "string") return false;

  let clean = text.trim().replace(/\s+/g, " ");

  clean = clean.replace(/[<>]/g, "").replace(/javascript:/gi, "");

  if (clean.length > 2000) clean = clean.substring(0, 2000) + "...";

  const links = clean.match(/https?:\/\/[^\s]+/g);
  if (links && links.length > 3) return false;

  const blocked = [
    "scam",
    "hack",
    "bitcoin",
    "porn",
    "nude",
    "xxx",
    "sex",
    "casino",
    "bet",
    "اباحي",
    "جنس",
    "نيك",
    "سكس",
    "دعارة",
    "عارية",
    "ممارسة",
    "مكالمة جنسية",
    "قبلات",
    "اغراء",
    "مثير",
    "تعري",
    "متناك",
    "شرموطة",
    "زب",
    "كس",
    "نيك جماعي",
    "لواط",
    "سحاق",
    "عاهرة",
    "دعوه",
    "كازينو",
    "مقامرة",
    "ربح مضمون",
    "استثمار سريع",
    "ارباح",
    "عملة رقمية",
  ];
  if (blocked.some((w) => clean.toLowerCase().includes(w))) return false;
  return clean;
}

export function whatsappSafeMiddleware(req, res, next) {
  const { body, media } = req.body;

  if (body && !media) {
    const clean = sanitizeTextMessage(body);
    if (!clean) {
      return res.status(400).json({ error: "Unsafe or invalid text message" });
    }
    req.body.message = clean;
    return next();
  }

  return res.status(400).json({ error: "No valid message or media provided" });
}
