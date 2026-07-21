// ============================================================
// Vercel serverless funksiyasi:  POST /api/lead
// Formadan kelgan arizani amoCRM (lead+contact) + Telegram'ga yuboradi.
// Barcha maxfiy kalitlar Vercel "Environment Variables" da saqlanadi.
// (Emojilar \u escape ko'rinishida - paste qilganda buzilmaydi.)
// ============================================================

module.exports = async function handler(req, res) {
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
    "REFAR - " + (lead.city || "") +
    (lead.rooms ? " - " + lead.rooms + "-xona" : "") +
    (lead.district ? " - " + lead.district : "");

  // ---------- 1) amoCRM: lead + contact ----------
  try {
    if (AMO_SUBDOMAIN && AMO_ACCESS_TOKEN) {
      const complexBody = [{
        name: leadTitle.trim() || ("REFAR - " + lead.name),
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
            .filter(Boolean).map(function (n) { return { name: String(n) }; })
        }
      }];

      const amoRes = await fetch(
        "https://" + AMO_SUBDOMAIN + ".amocrm.ru/api/v4/leads/complex",
        {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + AMO_ACCESS_TOKEN,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(complexBody)
        }
      );

      if (amoRes.ok) {
        result.amo = true;
        const data = await amoRes.json().catch(function () { return null; });
        const leadId = Array.isArray(data) && data[0] && data[0].id;

        if (leadId) {
          const noteText =
            "Yangi ariza - refar-sotuv.vercel.app\n" +
            "Ism: " + (lead.name || "-") + "\n" +
            "Tel: " + (lead.phone || "-") + "\n" +
            "Shahar: " + (lead.city || "-") + "\n" +
            "Tuman: " + (lead.district || "-") + "\n" +
            "Xonalar: " + (lead.rooms || "-") + "\n" +
            "Narx: " + (lead.price || (lead.price_negotiable ? "kelishiladi" : "-")) + "\n" +
            "Til: " + (lead.lang || "-") + "\n" +
            "UTM: source=" + (u.utm_source || "-") + " | medium=" + (u.utm_medium || "-") +
            " | campaign=" + (u.utm_campaign || "-") + " | content=" + (u.utm_content || "-") +
            " | term=" + (u.utm_term || "-") + "\n" +
            "Referrer: " + (u.referrer || "-");

          await fetch(
            "https://" + AMO_SUBDOMAIN + ".amocrm.ru/api/v4/leads/" + leadId + "/notes",
            {
              method: "POST",
              headers: {
                "Authorization": "Bearer " + AMO_ACCESS_TOKEN,
                "Content-Type": "application/json"
              },
              body: JSON.stringify([{ note_type: "common", params: { text: noteText } }])
            }
          ).catch(function () {});
        }
      } else {
        console.error("amoCRM error:", amoRes.status, await amoRes.text().catch(function () { return ""; }));
      }
    }
  } catch (e) {
    console.error("amoCRM exception:", e);
  }

  // ---------- 2) Telegram bildirishnoma (shahar bo'yicha) ----------
  try {
    const cityStr = (lead.city || "").toLowerCase();
    let chatId = TG_CHAT_ID;
    if (cityStr.indexOf("farg") > -1) chatId = TG_CHAT_FARG || TG_CHAT_ID;
    else if (cityStr.indexOf("tosh") > -1) chatId = TG_CHAT_TOSH || TG_CHAT_ID;

    if (TG_BOT_TOKEN && chatId) {
      const esc = function (s) {
        return String(s == null ? "-" : s)
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      };
      // Emojilar \u escape orqali - paste qilganda ham buzilmaydi:
      const text =
        "\u{1F3E0} <b>Yangi ariza - " + esc(lead.city) + "</b>\n" +
        "\u{1F464} " + esc(lead.name) + "\n" +
        "\u{1F4DE} " + esc(lead.phone) + "\n" +
        "\u{1F4CD} " + esc(lead.district) + " \u00B7 " + esc(lead.rooms) + "-xona\n" +
        "\u{1F4B0} " + esc(lead.price || (lead.price_negotiable ? "kelishiladi" : "-")) + "\n" +
        "\u{1F4CA} " + esc(u.utm_source) + " / " + esc(u.utm_campaign);

      const tgRes = await fetch("https://api.telegram.org/bot" + TG_BOT_TOKEN + "/sendMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML" })
      });
      result.telegram = tgRes.ok;
    }
  } catch (e) {
    console.error("Telegram exception:", e);
  }

  return res.status(200).json({ ok: true, ...result });
};
