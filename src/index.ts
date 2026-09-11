import "dotenv/config";
import { Bot, InlineKeyboard } from "grammy";
import OpenAI from "openai";
import { SYSTEM_PROMPT, buildPrompt } from "./prompt.js";

const required = ["TELEGRAM_BOT_TOKEN", "OPENAI_API_KEY", "ADMIN_TELEGRAM_ID", "CHANNEL_ID"] as const;
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} kiritilmagan`);
}

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const adminId = Number(process.env.ADMIN_TELEGRAM_ID);
const channelId = process.env.CHANNEL_ID!;
const model = process.env.OPENAI_MODEL || "gpt-5-mini";

type Media = { type: "photo" | "video"; fileId: string } | null;
type Draft = { text: string; media: Media };
const drafts = new Map<number, Draft>();

function isAdmin(id?: number) {
  return id === adminId;
}

function keyboard() {
  return new InlineKeyboard()
    .text("✅ Tasdiqlash", "publish")
    .text("🔄 Qayta yozish", "rewrite")
    .row()
    .text("❌ Bekor qilish", "cancel");
}

async function generate(raw: string, mode: "new" | "rewrite") {
  const response = await openai.responses.create({
    model,
    instructions: SYSTEM_PROMPT,
    input: buildPrompt(raw, mode),
  });
  const text = response.output_text.trim();
  if (!text) throw new Error("AI bo‘sh javob qaytardi");
  return text;
}

bot.use(async (ctx, next) => {
  if (!isAdmin(ctx.from?.id)) {
    await ctx.reply("Bu bot faqat Algoritm School ma’muriyati uchun ishlaydi.");
    return;
  }
  await next();
});

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Algoritm School AI SMM menejeri tayyor.\n\nXom matn, rasm yoki video yuboring. Men uni tayyor postga aylantiraman."
  );
});

bot.on(["message:text", "message:photo", "message:video"], async (ctx) => {
  const msg = ctx.message;
  const raw = ("text" in msg && msg.text) || msg.caption || "Algoritm School hayotidan yangi lavha";
  let media: Media = null;
  if (msg.photo?.length) media = { type: "photo", fileId: msg.photo.at(-1)!.file_id };
  if (msg.video) media = { type: "video", fileId: msg.video.file_id };

  const waiting = await ctx.reply("✍️ Post tayyorlanmoqda...");
  try {
    const text = await generate(raw, "new");
    drafts.set(ctx.chat.id, { text, media });
    await ctx.api.editMessageText(ctx.chat.id, waiting.message_id, text, { reply_markup: keyboard() });
  } catch (error) {
    console.error(error);
    await ctx.api.editMessageText(ctx.chat.id, waiting.message_id, "Post tayyorlashda xatolik yuz berdi. Qayta urinib ko‘ring.");
  }
});

bot.callbackQuery("rewrite", async (ctx) => {
  const draft = drafts.get(ctx.chat!.id);
  if (!draft) return ctx.answerCallbackQuery({ text: "Post topilmadi" });
  await ctx.answerCallbackQuery({ text: "Qayta yozilmoqda..." });
  try {
    draft.text = await generate(draft.text, "rewrite");
    await ctx.editMessageText(draft.text, { reply_markup: keyboard() });
  } catch (error) {
    console.error(error);
    await ctx.reply("Qayta yozishda xatolik yuz berdi.");
  }
});

bot.callbackQuery("publish", async (ctx) => {
  const draft = drafts.get(ctx.chat!.id);
  if (!draft) return ctx.answerCallbackQuery({ text: "Post topilmadi" });
  try {
    if (draft.media?.type === "photo") {
      await ctx.api.sendPhoto(channelId, draft.media.fileId, { caption: draft.text });
    } else if (draft.media?.type === "video") {
      await ctx.api.sendVideo(channelId, draft.media.fileId, { caption: draft.text });
    } else {
      await ctx.api.sendMessage(channelId, draft.text);
    }
    drafts.delete(ctx.chat!.id);
    await ctx.editMessageReplyMarkup();
    await ctx.reply("✅ Post kanalga joylandi.");
  } catch (error) {
    console.error(error);
    await ctx.reply("Postni kanalga joylashda xatolik yuz berdi. Botning administrator huquqlarini tekshiring.");
  }
});

bot.callbackQuery("cancel", async (ctx) => {
  drafts.delete(ctx.chat!.id);
  await ctx.answerCallbackQuery({ text: "Bekor qilindi" });
  await ctx.editMessageReplyMarkup();
});

bot.catch((error) => console.error("Bot xatosi:", error));
bot.start({ onStart: () => console.log("Algoritm School SMM bot ishga tushdi") });
