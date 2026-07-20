// Vercel serverless funksiyasi:  POST /api/lead
// Formadan kelgan arizani amoCRM (lead+contact) + Telegram'ga yuboradi.
// Barcha maxfiy kalitlar Vercel "Environment Variables" da saqlanadi (kodda EMAS).

module.exports = async function handler(req, res) {
  // CORS (o'z domeningizda kerak bo'lmaydi, lekin xavfsiz)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const lead = req.body || {};
  if (!lead.name || !lead.phone) {
    return res.status(400).json({ error: "name va phone majburiy" });
  }

  const {
    AMO_SUBDOMAIN,        // masalan: refar   (refar.amocrm.ru bo'lsa)
    AMO_ACCESS_TOKEN,     // uzoq muddatli (long-lived) token
    AMO_PIPELINE_ID,      // ixtiyoriy: voronka ID
    AMO_STATUS_ID,        // ixtiyoriy: boshlang'ich bosqich ID
    TG_BOT_TOKEN,         // Telegram bot tokeni (bitta bot ikkala guruhga yozadi)
    TG_CHAT_TOSH,         // Toshkent arizalari boradigan guruh/chat ID
    TG_CHAT_FARG,         // Farg'ona arizalari boradigan guruh/chat ID
    TG_CHAT_ID            // ixtiyoriy: umumiy fallback (shahar aniqlanmasa)
  } = process.env;

  const u = lead.utm || {};
  const result = { amo: false, telegram: false };

  const leadTitle =
    `REFAR В· ${lead.city || ""}` +
    (lead.rooms ? ` В· ${lead.rooms}-xona` : "") +
    (lead.district ? ` В· ${lead.district}` : "");

  // ---------- 1) amoCRM: lead + contact ----------
  try {
    if (AMO_SUBDOMAIN && AMO_ACCESS_TOKEN) {
      const complexBody = [{
        name: leadTitle.trim() || `REFAR В· ${lead.name}`,
        ...(AMO_PIPELINE_ID ? { pipeline_id: Number(AMO_PIPELINE_ID) } : {}),
        ...(AMO_STATUS_ID ? { status_id: Number(AMO_STATUS_ID) } : {}),
        _embedded: {
          contacts: [{
            name: lead.name,
            custom_fields_values: [
              { field_code: "PHONE", values: [{ value: lead.phone, enum_code: "WORK" }] }
            ]
          }],
          tags: [lead.status || "lead", lead.city, "kvartira", u.utm_source]
            .filter(Boolean).map(n => ({ name: String(n) }))
        }
      }];

      const amoRes = await fetch(
        `https://${AMO_SUBDOMAIN}.amocrm.ru/api/v4/leads/complex`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${AMO_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(complexBody)
        }
      );

      if (amoRes.ok) {
        result.amo = true;
        const data = await amoRes.json().catch(() => null);
        const leadId = Array.isArray(data) && data[0] && data[0].id;

        // Batafsil izoh (note) вЂ” agent hamma ma'lumotni ko'radi
        if (leadId) {
          const noteText =
`Yangi ariza вЂ” refar-sotuv.vercel.app
Ism: ${lead.name}
Tel: ${lead.phone}
Shahar: ${lead.city || "-"}
Tuman: ${lead.district || "-"}
Xonalar: ${lead.rooms || "-"}
Narx: ${lead.price || (lead.price_negotiable ? "kelishiladi" : "-")}
Til: ${lead.lang || "-"}
UTM: source=${u.utm_source || "-"} | medium=${u.utm_medium || "-"} | campaign=${u.utm_campaign || "-"} | content=${u.utm_content || "-"} | term=${u.utm_term || "-"}
Referrer: ${u.referrer || "-"}`;

          await fetch(
            `https://${AMO_SUBDOMAIN}.amocrm.ru/api/v4/leads/${leadId}/notes`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${AMO_ACCESS_TOKEN}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify([{ note_type: "common", params: { text: noteText } }])
            }
          ).catch(() => {});
        }
      } else {
        console.error("amoCRM error:", amoRes.status, await amoRes.text().catch(() => ""));
      }
    }
  } catch (e) {
    console.error("amoCRM exception:", e);
  }

  // ---------- 2) Telegram bildirishnoma ----------
  try {
    // Shahar bo'yicha guruhni tanlash
    const cityStr = (lead.city || "").toLowerCase();
    let chatId = TG_CHAT_ID;
    if (cityStr.includes("farg")) chatId = TG_CHAT_FARG || TG_CHAT_ID;
    else if (cityStr.includes("tosh")) chatId = TG_CHAT_TOSH || TG_CHAT_ID;

    if (TG_BOT_TOKEN && chatId) {
      const esc = s => String(s || "-").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const text =
`рџЏ  <b>Yangi ariza вЂ” ${esc(lead.city)}</b>
рџ‘¤ ${esc(lead.name)}
рџ“ћ ${esc(lead.phone)}
рџ“Ќ ${esc(lead.district)} В· ${esc(lead.rooms)}-xona
рџ’° ${esc(lead.price || (lead.price_negotiable ? "kelishiladi" : "-"))}
рџ“Љ ${esc(u.utm_source)} / ${esc(u.utm_campaign)}`;

      const tgRes = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" })
      });
      result.telegram = tgRes.ok;
    }
  } catch (e) {
    console.error("Telegram exception:", e);
  }

  return res.status(200).json({ ok: true, ...result });
}
