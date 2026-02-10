require('dotenv').config();
const { Bot, session, InlineKeyboard, Keyboard } = require('grammy');
const { createClient } = require('@supabase/supabase-js');

const bot = new Bot(process.env.STAFF_BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const OWNER_ID = Number(process.env.OWNER_TELEGRAM_ID);

bot.use(session({ initial: () => ({ state: null, data: {}, employee: null, shift: null }) }));

// =============================================
// КОНСТАНТЫ
// =============================================
const BRAND_EMOJI = {
  'ARQA':'🔶','BLAX':'⬛','CHN':'🇨🇳','CORVUS':'🐦','DLTA':'🔺','DRYMOST':'💧',
  'FAFF':'🔥','FEDRS ORIGINAL':'🦅','FEDRS REP.':'🦅','GUCCI':'👜','ICEBERG':'🧊',
  'ICEBURN':'❄️','ISTERIKA':'😤','KASTA':'👑','LYFT REP.':'🟢','MAD':'😈',
  'NICTECH':'⚡','PEREDOZ':'💀','PODONKI':'💣','PZDC':'🤯','R&M':'🌈',
  'SIMPSONS':'🟡','STALKER':'☢️','SWEEDEN':'🇸🇪','ВАТКИ LOOP':'🔄','ТРИНАШКА':'1️⃣3️⃣','ШОК':'⚡',
};

const DRINKS = [
  { name: 'МД', emoji: '🥤' },
  { name: 'КОЛА', emoji: '🥤' },
  { name: 'АДРЕНАЛИН', emoji: '⚡' },
  { name: 'БЕРН', emoji: '🔥' },
  { name: 'РЕДБУЛ', emoji: '🐂' },
  { name: 'ЧАЙ', emoji: '🍵' },
];

const CAN_COST = 400; // стоимость банки для расчёта недостачи

// =============================================
// СКИДКИ ЗА ОБЪЁМ
// =============================================
function volumeDiscount(totalCans) {
  if (totalCans >= 10) return { per: 80, gift: true };
  if (totalCans >= 7)  return { per: 60, gift: true };
  if (totalCans >= 5)  return { per: 50, gift: true };
  if (totalCans >= 2)  return { per: 30, gift: false };
  return { per: 0, gift: false };
}

// =============================================
// ЗП: 2000 + % от выручки
// Эффективные банки = всего - по картам - опт(7+)
// (обычная_выручка) * тариф% + (опт_выручка) * 1.5% + 2000
// =============================================
function salaryTier(effectiveCans) {
  if (effectiveCans >= 110) return 6;
  if (effectiveCans >= 100) return 5.5;
  if (effectiveCans >= 90) return 5;
  if (effectiveCans >= 80) return 4.5;
  if (effectiveCans >= 70) return 4;
  if (effectiveCans >= 55) return 3.5;
  if (effectiveCans >= 40) return 2.5;
  return 0;
}

function calcSalary(orders, baseSalary = 2000) {
  let totalCans = 0, cardCans = 0, wholesaleCans = 0;
  let totalRev = 0, wholesaleRev = 0;

  for (const o of orders) {
    const cans = (o.позиции_в_заказах || []).reduce((s, p) => s + (p.количество || 0), 0);
    const rev = o.итоговая_сумма || 0;
    const isCard = (o.комментарий || '').includes('[КАРТА]');
    const isWholesale = cans >= 7;

    totalCans += cans;
    totalRev += rev;

    if (isCard) cardCans += cans;
    if (isWholesale && !isCard) { wholesaleCans += cans; wholesaleRev += rev; }
  }

  const effectiveCans = totalCans - cardCans - wholesaleCans;
  const tier = salaryTier(effectiveCans);
  const normalRev = totalRev - wholesaleRev;
  const salary = Math.round(normalRev * tier / 100 + wholesaleRev * 1.5 / 100 + baseSalary);

  return { totalCans, cardCans, wholesaleCans, effectiveCans, tier, normalRev, wholesaleRev, salary };
}

// =============================================
// КЛАВИАТУРЫ
// =============================================
function sellerKB(hasShift) {
  if (!hasShift) return new Keyboard().text('📂 Открыть смену').row().text('📋 Завершённые').text('📝 Задачи').resized();
  return new Keyboard()
    .text('➕ Продажа').text('📋 Завершённые').row()
    .text('↩️ Возврат').text('💸 Расход').row()
    .text('🎁 Себе').text('💼 Инкассация').row()
    .text('📊 Сегодня').text('🆘 SOS').row()
    .text('☕ Перерыв').text('🔒 Закрыть смену')
    .resized();
}

function ownerKB(hasShift) {
  const kb = new Keyboard();
  if (!hasShift) kb.text('📂 Открыть смену').row();
  else {
    kb.text('➕ Продажа').text('📋 Завершённые').row()
      .text('↩️ Возврат').text('💸 Расход').row()
      .text('🎁 Себе').text('💼 Инкассация').row()
      .text('📊 Сегодня').text('🆘 SOS').row()
      .text('☕ Перерыв').text('🔒 Закрыть смену').row();
  }
  kb.text('─── Управление ───').row()
    .text('📈 Топ продаж').text('📊 Статистика').row()
    .text('👥 Сотрудники').text('➕👤 Сотрудник').row()
    .text('💸 Удержания').text('📦 Поступление').row()
    .text('🔄 Перемещение').text('📝 Задачи').resized();
  return kb;
}

function editorKB() {
  return new Keyboard().text('📦 Поступление').text('🔄 Перемещение').row()
    .text('📋 Завершённые').text('📊 Сегодня').row().text('📝 Задачи').resized();
}

function getKB(emp, shift) {
  if (emp.роль === 'Владелец') return ownerKB(!!shift);
  if (emp.роль === 'Редактор') return editorKB();
  return sellerKB(!!shift);
}

// =============================================
// ХЕЛПЕРЫ
// =============================================
async function getEmp(tgId) {
  const { data } = await supabase.from('сотрудники').select('*, точки(название)')
    .eq('telegram_id', tgId).eq('активен', true).single();
  return data;
}
async function getShift(empId) {
  const { data } = await supabase.from('смены').select('*')
    .eq('сотрудник_id', empId).eq('статус', 'Открыта')
    .order('created_at', { ascending: false }).limit(1).single();
  return data;
}
function today() { return new Date().toISOString().split('T')[0]; }
function now() { return new Date().toISOString(); }
function timeStr() { return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
function isSeller(e) { return ['Продавец', 'Владелец'].includes(e?.роль); }
function isManager(e) { return ['Владелец', 'Редактор'].includes(e?.роль); }

function brandEmoji(brand) { return BRAND_EMOJI[brand] || '📦'; }

// =============================================
// /start /id /register_owner
// =============================================
bot.command('id', (ctx) => ctx.reply(`Ваш Telegram ID: ${ctx.from.id}`));

bot.command('start', async (ctx) => {
  const emp = await getEmp(ctx.from.id);
  if (!emp) { return ctx.from.id === OWNER_ID ? ctx.reply('👑 /register_owner') : ctx.reply('⛔ Не зарегистрированы.'); }
  ctx.session.employee = emp; ctx.session.state = null; ctx.session.data = {};
  if (isSeller(emp)) ctx.session.shift = await getShift(emp.id);
  const em = { 'Продавец': '🏪', 'Курьер': '🚗', 'Редактор': '✏️', 'Владелец': '👑' };
  const sh = isSeller(emp) ? (ctx.session.shift ? '\n🟢 Смена открыта' : '\n⚪ Смена закрыта') : '';
  await ctx.reply(`${em[emp.роль] || '👤'} ${emp.имя}\n${emp.роль} • ${emp.точки?.название || '—'}${sh}`,
    { reply_markup: getKB(emp, ctx.session.shift) });
});

bot.command('register_owner', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return;
  const ex = await getEmp(ctx.from.id);
  if (ex) return ctx.reply('Уже! /start');
  await supabase.from('сотрудники').insert({
    telegram_id: ctx.from.id, telegram_username: ctx.from.username ? `@${ctx.from.username}` : null,
    имя: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ''),
    роль: 'Владелец', активен: true, зп_база: 0,
  });
  ctx.reply('✅ /start');
});

// MIDDLEWARE
bot.use(async (ctx, next) => {
  if (!ctx.session.employee && (ctx.message?.text || ctx.callbackQuery)) {
    const emp = await getEmp(ctx.from.id);
    if (!emp) { if (ctx.message?.text) return ctx.reply('⛔ /start'); return; }
    ctx.session.employee = emp;
    if (isSeller(emp)) ctx.session.shift = await getShift(emp.id);
  }
  return next();
});

// =============================================
// 📂 ОТКРЫТЬ СМЕНУ
// =============================================
bot.hears('📂 Открыть смену', async (ctx) => {
  const emp = ctx.session.employee;
  if (!isSeller(emp)) return;
  if (ctx.session.shift) return ctx.reply('⚠️ Уже открыта!');
  if (!emp.точка_id) {
    const { data: pts } = await supabase.from('точки').select('id, название').eq('активна', true);
    const kb = new InlineKeyboard();
    (pts || []).forEach(p => kb.text(`🏪 ${p.название}`, `shpt_${p.id}`).row());
    return ctx.reply('Точка:', { reply_markup: kb });
  }
  ctx.session.state = 'sh_cans'; ctx.session.data = {};
  await ctx.reply(`📂 ${emp.имя}, открываем смену\n\n📦 Банок на начало?`, { reply_markup: { remove_keyboard: true } });
});

bot.callbackQuery(/^shpt_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  const { data: pt } = await supabase.from('точки').select('название').eq('id', id).single();
  ctx.session.employee.точка_id = id; ctx.session.employee.точки = pt;
  ctx.session.state = 'sh_cans'; ctx.session.data = {};
  const emp = ctx.session.employee;
  await ctx.editMessageText(`🏪 ${pt?.название}\n${emp.имя}, открываем смену\n\n📦 Банок?`);
  await ctx.answerCallbackQuery();
});

bot.on('message:text').filter(c => c.session.state === 'sh_cans', async (ctx) => {
  const n = parseInt(ctx.message.text); if (isNaN(n) || n < 0) return ctx.reply('Число:');
  ctx.session.data.cans = n; ctx.session.state = 'sh_soda'; await ctx.reply('🥤 Газировок?');
});
bot.on('message:text').filter(c => c.session.state === 'sh_soda', async (ctx) => {
  const n = parseInt(ctx.message.text); if (isNaN(n) || n < 0) return ctx.reply('Число:');
  ctx.session.data.soda = n; ctx.session.state = 'sh_cash'; await ctx.reply('💵 Наличных?');
});
bot.on('message:text').filter(c => c.session.state === 'sh_cash', async (ctx) => {
  const n = parseFloat(ctx.message.text); if (isNaN(n) || n < 0) return ctx.reply('Сумма:');
  const emp = ctx.session.employee;
  const { data: shift, error } = await supabase.from('смены').insert({
    сотрудник_id: emp.id, точка_id: emp.точка_id, дата: today(),
    время_открытия: now(), статус: 'Открыта',
    банки_начало: ctx.session.data.cans, газировка_начало: ctx.session.data.soda, нал_начало: n,
  }).select().single();
  if (error) return ctx.reply(`❌ ${error.message}`);
  ctx.session.shift = shift; ctx.session.state = null; ctx.session.data = {};
  await ctx.reply(
    `✅ ${emp.имя}, смена открыта!\n📅 ${today()} ${timeStr()}\n🏪 ${emp.точки?.название || ''}\n📦 ${shift.банки_начало} | 🥤 ${shift.газировка_начало} | 💵 ${n}₽`,
    { reply_markup: getKB(emp, shift) });
});

// =============================================
// ➕ ПРОДАЖА
// =============================================
bot.hears('➕ Продажа', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Сначала смену!');
  ctx.session.data = { items: [], discountType: 'vol' };
  const kb = new InlineKeyboard();
  kb.text('📦 Снюс', 'cat_snus').row();
  kb.text('🥤 Напитки', 'cat_drinks').row();
  kb.text('❌ Отмена', 's_cx');
  await ctx.reply('Категория:', { reply_markup: kb });
});

// --- НАПИТКИ ---
bot.callbackQuery('cat_drinks', async (ctx) => {
  const kb = new InlineKeyboard();
  DRINKS.forEach(d => { kb.text(`${d.emoji} ${d.name}`, `dr_${d.name}`).row(); });
  kb.text('⬅️ Назад', 'cat_back').text('❌ Отмена', 's_cx');
  await ctx.editMessageText('🥤 Напитки:', { reply_markup: kb }); await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^dr_(.+)$/, async (ctx) => {
  ctx.session.data.drinkName = ctx.match[1];
  ctx.session.state = 'dr_price';
  await ctx.editMessageText(`🥤 ${ctx.match[1]}\n\nЦена (₽):`); await ctx.answerCallbackQuery();
});

bot.on('message:text').filter(c => c.session.state === 'dr_price', async (ctx) => {
  const price = parseFloat(ctx.message.text); if (isNaN(price) || price < 0) return ctx.reply('Цена:');
  const name = ctx.session.data.drinkName;
  ctx.session.data.items.push({
    product: { id: 0, название: `🥤 ${name}`, вкус: name, бренд: 'Напитки', цена_безнал: price },
    qty: 1, price, time: timeStr(), isDrink: true,
  });
  ctx.session.state = null;
  await showCart(ctx);
});

bot.callbackQuery('cat_back', async (ctx) => {
  const kb = new InlineKeyboard();
  kb.text('📦 Снюс', 'cat_snus').row().text('🥤 Напитки', 'cat_drinks').row().text('❌ Отмена', 's_cx');
  await ctx.editMessageText('Категория:', { reply_markup: kb }); await ctx.answerCallbackQuery();
});

// --- СНЮС КАТАЛОГ ---
bot.callbackQuery('cat_snus', async (ctx) => { await showBrands(ctx, 's'); });

async function showBrands(ctx, p) {
  const { data } = await supabase.from('товары').select('бренд').eq('активен', true);
  const brands = [...new Set((data || []).map(x => x.бренд).filter(Boolean))].sort();
  ctx.session.data.brands = brands;
  const kb = new InlineKeyboard();
  brands.forEach(b => { kb.text(`${brandEmoji(b)} ${b}`, `${p}b_${encodeURIComponent(b)}`).row(); });
  kb.text('🥤 Напитки', 'cat_drinks').row();
  kb.text('❌ Отмена', `${p}_cx`);
  try { await ctx.editMessageText('🛒 Марка:', { reply_markup: kb }); if (ctx.callbackQuery) await ctx.answerCallbackQuery(); }
  catch { await ctx.reply('🛒 Марка:', { reply_markup: kb }); }
}

bot.callbackQuery(/^(s|ts)b_(.+)$/, async (ctx) => {
  const p = ctx.match[1], brand = decodeURIComponent(ctx.match[2]);
  ctx.session.data.brand = brand;
  const { data } = await supabase.from('товары').select('линейка').eq('бренд', brand).eq('активен', true);
  const lines = [...new Set((data || []).map(x => x.линейка).filter(Boolean))].sort();
  ctx.session.data.lines = lines;
  const kb = new InlineKeyboard();
  lines.forEach(l => { kb.text(`📋 ${l}`, `${p}l_${encodeURIComponent(l)}`).row(); });
  kb.text('⬅️ Марки', `${p}_tobr`).row().text('❌ Отмена', `${p}_cx`);
  await ctx.editMessageText(`${brandEmoji(brand)} ${brand}\n\nЛинейка:`, { reply_markup: kb }); await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^(s|ts)l_(.+)$/, async (ctx) => {
  ctx.session.data.line = decodeURIComponent(ctx.match[2]);
  await showFlavors(ctx, ctx.match[1]);
});

async function showFlavors(ctx, p) {
  const { brand, line } = ctx.session.data;
  const { data: products } = await supabase.from('товары')
    .select('id, вкус, название, цена_безнал')
    .eq('бренд', brand).eq('линейка', line).eq('активен', true).order('вкус');
  ctx.session.data.flavors = products || [];
  const kb = new InlineKeyboard();
  (products || []).forEach(pr => {
    kb.text(`🔹 ${(pr.вкус || pr.название || '?').substring(0, 35)} — ${pr.цена_безнал}₽`, `${p}f_${pr.id}`).row();
  });
  kb.text('⬅️ Линейки', `${p}_toln`).text('⬅️ Марки', `${p}_tobr`).row();
  kb.text('🏠 Меню', `${p}_mn`).text('❌ Отмена', `${p}_cx`);
  try { await ctx.editMessageText(`${brandEmoji(brand)} ${brand} • ${line}\n\nВкус:`, { reply_markup: kb }); }
  catch { await ctx.reply(`${brandEmoji(brand)} ${brand} • ${line}\n\nВкус:`, { reply_markup: kb }); }
  if (ctx.callbackQuery) try { await ctx.answerCallbackQuery(); } catch {}
}

// Вкус → кол-во / себе
bot.callbackQuery(/^(s|ts)f_(\d+)$/, async (ctx) => {
  const p = ctx.match[1], id = parseInt(ctx.match[2]);
  const { data: product } = await supabase.from('товары').select('*').eq('id', id).single();
  if (!product) return ctx.answerCallbackQuery('!');
  ctx.session.data.curProduct = product;

  if (p === 'ts') {
    // СЕБЕ — проверяем лимит 1/нед
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: shifts } = await supabase.from('смены').select('товар_себе')
      .eq('сотрудник_id', ctx.session.employee.id).gte('created_at', weekAgo);
    const weekSelf = (shifts || []).filter(s => s.товар_себе).length;
    if (weekSelf >= 1) {
      await ctx.editMessageText('⚠️ Лимит: 1 шайба в неделю. Уже брали.');
      return ctx.answerCallbackQuery('Лимит!');
    }
    const sh = ctx.session.shift;
    const val = sh?.товар_себе ? `${sh.товар_себе}, ${product.название}` : product.название;
    await supabase.from('смены').update({ товар_себе: val }).eq('id', sh.id);
    sh.товар_себе = val;
    const kb = new InlineKeyboard().text('🏠 Меню', 'ts_mn');
    await ctx.editMessageText(`✅ ${product.название} (скидка 100%)\nСебе: ${val}`, { reply_markup: kb });
    return ctx.answerCallbackQuery('Записано!');
  }

  // ПРОДАЖА — количество
  const kb = new InlineKeyboard();
  for (let i = 1; i <= 5; i++) kb.text(`${i}`, `sq_${i}`);
  kb.row();
  for (let i = 6; i <= 10; i++) kb.text(`${i}`, `sq_${i}`);
  kb.row();
  kb.text('⬅️ Вкусы', 's_tofl').text('⬅️ Марки', 's_tobr').row().text('❌ Отмена', 's_cx');
  await ctx.editMessageText(
    `${brandEmoji(product.бренд)} ${product.название}\n💰 ${product.цена_безнал}₽\n\nКоличество:`, { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

// Количество → корзина
bot.callbackQuery(/^sq_(\d+)$/, async (ctx) => {
  const qty = parseInt(ctx.match[1]);
  const pr = ctx.session.data.curProduct;
  if (!pr) return ctx.answerCallbackQuery('Ошибка');
  ctx.session.data.items.push({ product: pr, qty, price: pr.цена_безнал, time: timeStr() });
  await showCart(ctx);
  await ctx.answerCallbackQuery('✅');
});

// Корзина
async function showCart(ctx) {
  const items = ctx.session.data.items;
  const snusItems = items.filter(i => !i.isDrink && !i.isGift);
  const totalCans = snusItems.reduce((s, i) => s + i.qty, 0);
  const snusRaw = snusItems.reduce((s, i) => s + (i.price * i.qty), 0);
  const drinkTotal = items.filter(i => i.isDrink).reduce((s, i) => s + (i.price * i.qty), 0);
  const disc = volumeDiscount(totalCans);
  const snusDiscounted = snusRaw - (disc.per * totalCans);
  const finalTotal = snusDiscounted + drinkTotal;

  let cart = items.map((it, i) =>
    `${i + 1}. ${(it.product.вкус || it.product.название).substring(0, 28)} ×${it.qty} = ${it.price * it.qty}₽ (${it.time})`
  ).join('\n');

  cart += `\n\n📦 Банок: ${totalCans}`;
  if (disc.per > 0) cart += `\n🏷 -${disc.per}₽×${totalCans} = -${disc.per * totalCans}₽`;
  if (disc.gift) cart += `\n🎁 + шайба в подарок`;
  if (drinkTotal > 0) cart += `\n🥤 Напитки: ${drinkTotal}₽`;
  cart += `\n💰 Итого: ${finalTotal}₽`;

  const kb = new InlineKeyboard()
    .text('➕ Снюс', 'cat_snus').text('🥤 Напитки', 'cat_drinks').row()
    .text('✅ Оформить', 'sale_go').row()
    .text('🗑 Убрать последний', 'sale_del').row()
    .text('❌ Отменить', 's_cx');

  try { await ctx.editMessageText(`🛒 Корзина:\n${cart}`, { reply_markup: kb }); }
  catch { await ctx.reply(`🛒 Корзина:\n${cart}`, { reply_markup: kb }); }
}

bot.callbackQuery('sale_del', async (ctx) => {
  if (ctx.session.data.items?.length) ctx.session.data.items.pop();
  if (!ctx.session.data.items?.length) { await ctx.editMessageText('🛒 Пусто'); return showBrands(ctx, 's'); }
  await showCart(ctx); await ctx.answerCallbackQuery('Убрано');
});

// Оформить → подарок (если 5+) → скидка → оплата → клиент
bot.callbackQuery('sale_go', async (ctx) => {
  const items = ctx.session.data.items.filter(i => !i.isDrink && !i.isGift);
  const totalCans = items.reduce((s, i) => s + i.qty, 0);
  const disc = volumeDiscount(totalCans);

  if (disc.gift && !ctx.session.data.giftAdded) {
    // Спросить какая шайба в подарок
    ctx.session.data.giftPending = true;
    await ctx.editMessageText('🎁 Какая шайба в подарок?\n\nВведите название или часть:');
    ctx.session.state = 'gift_search';
    return ctx.answerCallbackQuery();
  }

  await showDiscountChoice(ctx);
  await ctx.answerCallbackQuery();
});

// Поиск подарочной шайбы
bot.on('message:text').filter(c => c.session.state === 'gift_search', async (ctx) => {
  const { data: prods } = await supabase.from('товары').select('id, название, бренд')
    .ilike('название', `%${ctx.message.text.trim()}%`).eq('активен', true).limit(10);
  if (!prods?.length) return ctx.reply('Не найдено. Ещё:');
  const kb = new InlineKeyboard();
  prods.forEach(p => kb.text(`${brandEmoji(p.бренд)} ${p.название.substring(0, 35)}`, `gift_${p.id}`).row());
  kb.text('⏩ Без подарка', 'gift_skip');
  await ctx.reply('Выберите:', { reply_markup: kb });
});

bot.callbackQuery(/^gift_(\d+)$/, async (ctx) => {
  const { data: p } = await supabase.from('товары').select('*').eq('id', parseInt(ctx.match[1])).single();
  if (p) {
    ctx.session.data.items.push({ product: p, qty: 1, price: 0, time: timeStr(), isGift: true });
    ctx.session.data.giftAdded = true;
  }
  ctx.session.state = null;
  await ctx.editMessageText(`🎁 Подарок: ${p?.название || '?'}`);
  await showDiscountChoice(ctx);
  await ctx.answerCallbackQuery();
});

bot.callbackQuery('gift_skip', async (ctx) => {
  ctx.session.data.giftAdded = true; ctx.session.state = null;
  await showDiscountChoice(ctx); await ctx.answerCallbackQuery();
});

// Тип скидки
async function showDiscountChoice(ctx) {
  const kb = new InlineKeyboard()
    .text('📦 Обычная (объём)', 'sdt_vol').row()
    .text('🏷 Карта 10%', 'sdt_c10').text('🏷 25%', 'sdt_c25').row()
    .text('🏷 50%', 'sdt_c50').text('🏷 100% (400₽)', 'sdt_c100').row()
    .text('👥 Друг', 'sdt_friend').row()
    .text('⬅️ Корзина', 'sale_backcart');

  const items = ctx.session.data.items.filter(i => !i.isDrink && !i.isGift);
  const totalCans = items.reduce((s, i) => s + i.qty, 0);
  const raw = items.reduce((s, i) => s + i.price * i.qty, 0);
  const disc = volumeDiscount(totalCans);

  try { await ctx.editMessageText(`📦 ${totalCans} банок | 💰 ${raw}₽\n🏷 Объём: -${disc.per}₽×${totalCans}\n\nТип скидки:`, { reply_markup: kb }); }
  catch { await ctx.reply(`📦 ${totalCans} банок | 💰 ${raw}₽\n\nТип скидки:`, { reply_markup: kb }); }
}

bot.callbackQuery('sale_backcart', async (ctx) => { await showCart(ctx); await ctx.answerCallbackQuery(); });

bot.callbackQuery(/^sdt_(vol|c10|c25|c50|c100|friend)$/, async (ctx) => {
  const type = ctx.match[1];

  if (type === 'friend') {
    ctx.session.state = 'friend_disc'; ctx.session.data.discountType = 'friend';
    await ctx.editMessageText('👥 Скидка друга — сумма скидки (₽):');
    return ctx.answerCallbackQuery();
  }

  ctx.session.data.discountType = type;
  await showPayment(ctx);
  await ctx.answerCallbackQuery();
});

bot.on('message:text').filter(c => c.session.state === 'friend_disc', async (ctx) => {
  const n = parseFloat(ctx.message.text); if (isNaN(n) || n < 0) return ctx.reply('Сумма:');
  ctx.session.data.friendDisc = n; ctx.session.state = null;
  await showPayment(ctx);
});

async function showPayment(ctx) {
  const items = ctx.session.data.items;
  const snusItems = items.filter(i => !i.isDrink && !i.isGift);
  const totalCans = snusItems.reduce((s, i) => s + i.qty, 0);
  const snusRaw = snusItems.reduce((s, i) => s + i.price * i.qty, 0);
  const drinkTotal = items.filter(i => i.isDrink).reduce((s, i) => s + i.price * i.qty, 0);
  const type = ctx.session.data.discountType;

  let snusFinal = snusRaw;
  let discLabel = '';

  if (type === 'vol') {
    const disc = volumeDiscount(totalCans);
    snusFinal = snusRaw - (disc.per * totalCans);
    discLabel = `Объём -${disc.per}₽×${totalCans}`;
  } else if (type === 'c100') {
    // 100% карта = макс 400₽ скидка на каждую банку. Если цена > 400, доплата разницы
    snusFinal = snusItems.reduce((s, i) => s + Math.max(0, i.price - 400) * i.qty, 0);
    discLabel = `Карта 100% (макс 400₽/шт)`;
  } else if (type?.startsWith('c')) {
    const pct = parseInt(type.substring(1));
    snusFinal = Math.round(snusRaw * (100 - pct) / 100);
    discLabel = `Карта ${pct}%`;
  } else if (type === 'friend') {
    snusFinal = snusRaw - (ctx.session.data.friendDisc || 0);
    discLabel = `Друг -${ctx.session.data.friendDisc}₽`;
  }

  const grand = Math.max(0, snusFinal) + drinkTotal;
  ctx.session.data.finalTotal = grand;
  ctx.session.data.discLabel = discLabel;

  const kb = new InlineKeyboard()
    .text(`💵 Нал ${grand}₽`, 'spay_cash')
    .text(`💳 Безнал ${grand}₽`, 'spay_card').row()
    .text('⬅️ Назад', 'sale_go');

  try { await ctx.editMessageText(`${discLabel ? '🏷 ' + discLabel + '\n' : ''}💰 ${grand}₽\n\nОплата:`, { reply_markup: kb }); }
  catch { await ctx.reply(`${discLabel ? '🏷 ' + discLabel + '\n' : ''}💰 ${grand}₽\n\nОплата:`, { reply_markup: kb }); }
}

bot.callbackQuery(/^spay_(cash|card)$/, async (ctx) => {
  ctx.session.data.payType = ctx.match[1] === 'cash' ? 'Наличные' : 'Безналичные';
  ctx.session.state = 'sale_client';
  const kb = new InlineKeyboard().text('⏩ Без клиента', 'sale_nocl').row().text('⬅️ Назад', 'sale_go');
  await ctx.editMessageText('👤 Код клиента (4 цифры + буква):', { reply_markup: kb }); await ctx.answerCallbackQuery();
});

bot.callbackQuery('sale_nocl', async (ctx) => { ctx.session.data.client = null; await finishSale(ctx); await ctx.answerCallbackQuery(); });

bot.on('message:text').filter(c => c.session.state === 'sale_client', async (ctx) => {
  const code = ctx.message.text.trim().toUpperCase();
  const { data: cl } = await supabase.from('клиенты').select('*').eq('уникальный_номер', code).single();
  if (!cl) { const kb = new InlineKeyboard().text('⏩ Без клиента', 'sale_nocl'); return ctx.reply(`❌ "${code}" не найден.`, { reply_markup: kb }); }
  ctx.session.data.client = cl; await ctx.reply(`✅ ${cl.имя || code}`);
  await finishSale(ctx);
});

async function finishSale(ctx) {
  const emp = ctx.session.employee, sh = ctx.session.shift;
  const items = ctx.session.data.items, client = ctx.session.data.client;
  const payType = ctx.session.data.payType || 'Безналичные';
  const grand = ctx.session.data.finalTotal || 0;
  const discType = ctx.session.data.discountType || 'vol';
  const discLabel = ctx.session.data.discLabel || '';
  const isCard = discType.startsWith('c');
  const cash = payType === 'Наличные' ? grand : 0;
  const card = payType === 'Безналичные' ? grand : 0;
  const totalCans = items.filter(i => !i.isDrink && !i.isGift).reduce((s, i) => s + i.qty, 0);

  const comment = [
    discLabel || null,
    isCard ? '[КАРТА]' : null,
    items.find(i => i.isGift) ? `Подарок: ${items.find(i => i.isGift).product.название}` : null,
  ].filter(Boolean).join(' | ');

  const { data: order, error } = await supabase.from('заказы').insert({
    клиент_id: client?.id || null, точка_id: emp.точка_id, статус: 'Завершён',
    тип_доставки: 'Самовывоз', тип_оплаты: payType,
    сумма_товаров: items.reduce((s, i) => s + i.price * i.qty, 0),
    итоговая_сумма: grand, сумма_безнал: card, сумма_нал: cash,
    продавец_id: emp.id, комментарий: comment || null,
    товары_json: JSON.stringify(items.map(i => ({
      id: i.product.id, name: i.product.название, qty: i.qty, price: i.price, time: i.time,
      gift: i.isGift || false, drink: i.isDrink || false,
    }))),
  }).select().single();

  if (error) { ctx.session.state = null; return ctx.reply(`❌ ${error.message}`, { reply_markup: getKB(emp, sh) }); }

  for (const item of items.filter(i => !i.isDrink)) {
    await supabase.from('позиции_в_заказах').insert({
      заказ_id: order.id, товар_id: item.product.id, количество: item.qty,
      цена_за_единицу: item.price, тип_оплаты: payType,
    });
    if (item.product.id) {
      const { data: inv } = await supabase.from('инвентарь').select('id, количество')
        .eq('товар_id', item.product.id).eq('точка_id', emp.точка_id).single();
      if (inv) await supabase.from('инвентарь')
        .update({ количество: Math.max(0, inv.количество - item.qty), последнее_обновление: now() }).eq('id', inv.id);
    }
  }

  const nc = (sh.банок_продано || 0) + totalCans;
  const nr = (sh.выручка_общая || 0) + grand;
  await supabase.from('смены').update({
    банок_продано: nc, выручка_общая: nr,
    выручка_безнал: (sh.выручка_безнал || 0) + card,
    выручка_нал_факт: (sh.выручка_нал_факт || 0) + cash,
  }).eq('id', sh.id);
  sh.банок_продано = nc; sh.выручка_общая = nr;
  sh.выручка_безнал = (sh.выручка_безнал || 0) + card;
  sh.выручка_нал_факт = (sh.выручка_нал_факт || 0) + cash;

  ctx.session.state = null; ctx.session.data = {};
  let msg = `✅ ${order.номер_заказа} | ⏰ ${timeStr()}\n\n`;
  msg += items.map(i => `• ${i.isGift ? '🎁 ' : ''}${i.product.название.substring(0, 35)} ×${i.qty}${i.price ? ' = ' + (i.price * i.qty) + '₽' : ' ПОДАРОК'}`).join('\n');
  if (discLabel) msg += `\n\n🏷 ${discLabel}`;
  msg += `\n💰 ${grand}₽ ${payType === 'Наличные' ? '💵' : '💳'}`;
  if (client) msg += `\n👤 ${client.имя || client.уникальный_номер}`;
  msg += `\n📦 За смену: ${nc} банок`;
  await ctx.reply(msg, { reply_markup: getKB(emp, sh) });
}

// =============================================
// НАВИГАЦИЯ
// =============================================
bot.callbackQuery(/^(s|ts)_tobr$/, async (ctx) => { await showBrands(ctx, ctx.match[1]); });
bot.callbackQuery(/^(s|ts)_toln$/, async (ctx) => {
  const p = ctx.match[1], brand = ctx.session.data.brand;
  if (!brand) return showBrands(ctx, p);
  const { data } = await supabase.from('товары').select('линейка').eq('бренд', brand).eq('активен', true);
  const lines = [...new Set((data || []).map(x => x.линейка).filter(Boolean))].sort();
  ctx.session.data.lines = lines;
  const kb = new InlineKeyboard();
  lines.forEach(l => { kb.text(`📋 ${l}`, `${p}l_${encodeURIComponent(l)}`).row(); });
  kb.text('⬅️ Марки', `${p}_tobr`).row().text('❌', `${p}_cx`);
  await ctx.editMessageText(`${brandEmoji(brand)} ${brand}\nЛинейка:`, { reply_markup: kb }); await ctx.answerCallbackQuery();
});
bot.callbackQuery(/^(s|ts)_tofl$/, async (ctx) => {
  if (!ctx.session.data.brand || !ctx.session.data.line) return showBrands(ctx, ctx.match[1]);
  await showFlavors(ctx, ctx.match[1]);
});
bot.callbackQuery(/^(s|ts)_mn$/, async (ctx) => {
  ctx.session.state = null; ctx.session.data = {};
  await ctx.editMessageText('🏠'); await ctx.answerCallbackQuery();
  await ctx.reply('Меню:', { reply_markup: getKB(ctx.session.employee, ctx.session.shift) });
});
bot.callbackQuery(/^(s|ts)_cx$/, async (ctx) => {
  const items = ctx.session.data.items || [];
  if (!items.length) { ctx.session.state = null; ctx.session.data = {}; await ctx.editMessageText('❌'); return ctx.answerCallbackQuery(); }
  const p = ctx.match[1];
  const kb = new InlineKeyboard().text('✅ Да', `${p}_cxy`).text('↩️ Нет', `${p}_tobr`);
  await ctx.editMessageText(`⚠️ Корзина ${items.length} поз. Отменить?`, { reply_markup: kb }); await ctx.answerCallbackQuery();
});
bot.callbackQuery(/^(s|ts)_cxy$/, async (ctx) => {
  ctx.session.state = null; ctx.session.data = {};
  await ctx.editMessageText('❌'); await ctx.answerCallbackQuery();
  await ctx.reply('Меню:', { reply_markup: getKB(ctx.session.employee, ctx.session.shift) });
});

// =============================================
// 🎁 СЕБЕ (скидка 100%, макс 1/нед)
// =============================================
bot.hears('🎁 Себе', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Смену!');
  ctx.session.data = { items: [] };
  await showBrands(ctx, 'ts');
});

// =============================================
// ☕ ПЕРЕРЫВ
// =============================================
bot.hears('☕ Перерыв', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Смену!');
  ctx.session.state = 'brk_start';
  await ctx.reply('☕ Перерыв\n\nНачало (например 14:00):', { reply_markup: { remove_keyboard: true } });
});
bot.on('message:text').filter(c => c.session.state === 'brk_start', async (ctx) => {
  ctx.session.data.brkStart = ctx.message.text.trim(); ctx.session.state = 'brk_end';
  await ctx.reply('До (например 14:30):');
});
bot.on('message:text').filter(c => c.session.state === 'brk_end', async (ctx) => {
  ctx.session.data.brkEnd = ctx.message.text.trim(); ctx.session.state = 'brk_com';
  await ctx.reply('Комментарий (или «-»):');
});
bot.on('message:text').filter(c => c.session.state === 'brk_com', async (ctx) => {
  const emp = ctx.session.employee, sh = ctx.session.shift;
  const entry = `☕${ctx.session.data.brkStart}-${ctx.session.data.brkEnd} ${ctx.message.text}`;
  // Пытаемся записать в колонку перерывы, если нет — игнорируем
  try {
    const breaks = sh.перерывы ? sh.перерывы + '; ' : '';
    await supabase.from('смены').update({ перерывы: breaks + entry }).eq('id', sh.id);
    sh.перерывы = breaks + entry;
  } catch (e) { /* колонка может не существовать */ }
  ctx.session.state = null; ctx.session.data = {};
  await ctx.reply(`☕ ${entry}`, { reply_markup: getKB(emp, sh) });
});

// =============================================
// 📋 ЗАВЕРШЁННЫЕ
// =============================================
bot.hears('📋 Завершённые', async (ctx) => {
  const emp = ctx.session.employee;
  const filter = emp.роль !== 'Владелец' && emp.точка_id ? { точка_id: emp.точка_id } : {};
  const { data: orders } = await supabase.from('заказы').select('*, точки(название)')
    .match(filter).eq('статус', 'Завершён').gte('дата_создания', today() + 'T00:00:00')
    .order('дата_создания', { ascending: false }).limit(20);
  if (!orders?.length) return ctx.reply('📋 Пусто');
  for (const o of orders.slice(0, 10)) {
    const time = new Date(o.дата_создания).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    let items = ''; try { const j = JSON.parse(o.товары_json); items = j.map(i => `${(i.name || '?').substring(0, 25)}×${i.qty}`).join(', '); } catch {}
    const kb = new InlineKeyboard().text('✏️', `oedit_${o.id}`).text('🗑', `odel_${o.id}`);
    await ctx.reply(`${o.номер_заказа} ${time}\n${items}\n💰 ${o.итоговая_сумма}₽ ${o.тип_оплаты}${o.комментарий ? '\n📝 ' + o.комментарий : ''}`, { reply_markup: kb });
  }
});

bot.callbackQuery(/^odel_(\d+)$/, async (ctx) => {
  const kb = new InlineKeyboard().text('✅ Да', `odelc_${ctx.match[1]}`).text('↩️', 'x');
  await ctx.editMessageText(ctx.msg.text + '\n⚠️ Удалить?', { reply_markup: kb }); await ctx.answerCallbackQuery();
});
bot.callbackQuery(/^odelc_(\d+)$/, async (ctx) => {
  await supabase.from('позиции_в_заказах').delete().eq('заказ_id', parseInt(ctx.match[1]));
  await supabase.from('заказы').update({ статус: 'Удалён' }).eq('id', parseInt(ctx.match[1]));
  await ctx.editMessageText('🗑 Удалён'); await ctx.answerCallbackQuery();
});
bot.callbackQuery(/^oedit_(\d+)$/, async (ctx) => {
  const kb = new InlineKeyboard().text('💰 Сумму', `oechg_${ctx.match[1]}`).text('💳↔💵', `oepay_${ctx.match[1]}`).row().text('📝 Комент', `oecom_${ctx.match[1]}`);
  await ctx.editMessageText(ctx.msg.text + '\n✏️ Что?', { reply_markup: kb }); await ctx.answerCallbackQuery();
});
bot.callbackQuery(/^oepay_(\d+)$/, async (ctx) => {
  const { data: o } = await supabase.from('заказы').select('тип_оплаты').eq('id', parseInt(ctx.match[1])).single();
  const nt = o?.тип_оплаты === 'Наличные' ? 'Безналичные' : 'Наличные';
  await supabase.from('заказы').update({ тип_оплаты: nt }).eq('id', parseInt(ctx.match[1]));
  await ctx.editMessageText(`✅ → ${nt}`); await ctx.answerCallbackQuery();
});
bot.callbackQuery(/^oechg_(\d+)$/, async (ctx) => { ctx.session.state = 'oe_sum'; ctx.session.data.editId = parseInt(ctx.match[1]); await ctx.editMessageText('Сумма:'); await ctx.answerCallbackQuery(); });
bot.on('message:text').filter(c => c.session.state === 'oe_sum', async (ctx) => {
  const n = parseFloat(ctx.message.text); if (isNaN(n)) return ctx.reply('Сумма:');
  await supabase.from('заказы').update({ итоговая_сумма: n }).eq('id', ctx.session.data.editId);
  ctx.session.state = null; await ctx.reply(`✅ ${n}₽`, { reply_markup: getKB(ctx.session.employee, ctx.session.shift) });
});
bot.callbackQuery(/^oecom_(\d+)$/, async (ctx) => { ctx.session.state = 'oe_com'; ctx.session.data.editId = parseInt(ctx.match[1]); await ctx.editMessageText('Комент:'); await ctx.answerCallbackQuery(); });
bot.on('message:text').filter(c => c.session.state === 'oe_com', async (ctx) => {
  await supabase.from('заказы').update({ комментарий: ctx.message.text }).eq('id', ctx.session.data.editId);
  ctx.session.state = null; await ctx.reply('✅', { reply_markup: getKB(ctx.session.employee, ctx.session.shift) });
});
bot.callbackQuery('x', async (ctx) => { await ctx.answerCallbackQuery(); });

// =============================================
// 📊 СЕГОДНЯ | 💼 ИНКАССАЦИЯ | 💸 РАСХОД | ↩️ ВОЗВРАТ | 🆘 SOS
// =============================================
bot.hears('📊 Сегодня', async (ctx) => {
  const emp = ctx.session.employee;
  const filter = emp.роль !== 'Владелец' ? { продавец_id: emp.id } : {};
  const { data: orders } = await supabase.from('заказы')
    .select('итоговая_сумма, сумма_нал, сумма_безнал, позиции_в_заказах(количество)')
    .match(filter).eq('статус', 'Завершён').gte('дата_создания', today() + 'T00:00:00');
  if (!orders?.length) return ctx.reply('📊 Нет');
  const t = orders.reduce((s, o) => s + (o.итоговая_сумма || 0), 0);
  const cn = orders.reduce((s, o) => s + (o.позиции_в_заказах || []).reduce((ss, p) => ss + (p.количество || 0), 0), 0);
  await ctx.reply(`📊 ${orders.length} продаж | 📦 ${cn} банок | 💰 ${t}₽`);
});

bot.hears('💼 Инкассация', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️'); const sh = ctx.session.shift;
  ctx.session.state = 'inc_sum';
  const exp = (sh.нал_начало || 0) + (sh.выручка_нал_факт || 0) - (sh.доп_траты || 0);
  await ctx.reply(`💼 Нал ~${exp}₽\nСколько забираете?`, { reply_markup: { remove_keyboard: true } });
});
bot.on('message:text').filter(c => c.session.state === 'inc_sum', async (ctx) => {
  const n = parseFloat(ctx.message.text); if (isNaN(n) || n <= 0) return ctx.reply('Сумма:');
  const sh = ctx.session.shift; const tot = (sh.инкассация || 0) + n;
  await supabase.from('смены').update({ инкассация: tot }).eq('id', sh.id); sh.инкассация = tot;
  await supabase.from('расходы').insert({ точка_id: ctx.session.employee.точка_id, категория: 'Инкассация', сумма: n, описание: `${timeStr()}`, сотрудник_id: ctx.session.employee.id, смена_id: sh.id });
  ctx.session.state = null; await ctx.reply(`✅ ${n}₽ | Итого: ${tot}₽`, { reply_markup: getKB(ctx.session.employee, sh) });
});

bot.hears('💸 Расход', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️'); ctx.session.state = 'ex_desc';
  await ctx.reply('📝 Расход:', { reply_markup: { remove_keyboard: true } });
});
bot.on('message:text').filter(c => c.session.state === 'ex_desc', async (ctx) => { ctx.session.data.exD = ctx.message.text; ctx.session.state = 'ex_sum'; await ctx.reply('💰 Сумма:'); });
bot.on('message:text').filter(c => c.session.state === 'ex_sum', async (ctx) => {
  const n = parseFloat(ctx.message.text); if (isNaN(n) || n <= 0) return ctx.reply('Сумма:');
  const emp = ctx.session.employee, sh = ctx.session.shift;
  await supabase.from('расходы').insert({ точка_id: emp.точка_id, категория: 'Доп траты', сумма: n, описание: ctx.session.data.exD, сотрудник_id: emp.id, смена_id: sh?.id });
  if (sh) { await supabase.from('смены').update({ доп_траты: (sh.доп_траты || 0) + n }).eq('id', sh.id); sh.доп_траты = (sh.доп_траты || 0) + n; }
  ctx.session.state = null; ctx.session.data = {}; await ctx.reply(`✅ ${n}₽`, { reply_markup: getKB(emp, sh) });
});

bot.hears('↩️ Возврат', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️'); ctx.session.state = 'rt_r'; ctx.session.data = {};
  await ctx.reply('📝 Причина:', { reply_markup: { remove_keyboard: true } });
});
bot.on('message:text').filter(c => c.session.state === 'rt_r', async (ctx) => { ctx.session.data.rtR = ctx.message.text; ctx.session.state = 'rt_1'; await ctx.reply('📷 Фото 1/3:'); });
bot.on('message:photo').filter(c => ['rt_1', 'rt_2', 'rt_3'].includes(c.session.state), async (ctx) => {
  const f = ctx.message.photo.at(-1).file_id;
  if (ctx.session.state === 'rt_1') { ctx.session.data.p1 = f; ctx.session.state = 'rt_2'; return ctx.reply('📷 2/3:'); }
  if (ctx.session.state === 'rt_2') { ctx.session.data.p2 = f; ctx.session.state = 'rt_3'; return ctx.reply('📷 3/3:'); }
  const emp = ctx.session.employee;
  await supabase.from('возвраты').insert({ причина: ctx.session.data.rtR, фото_упаковки: ctx.session.data.p1, фото_содержимого: ctx.session.data.p2, фото_дополнительное: f, статус: 'На рассмотрении', продавец_id: emp.id });
  const { data: m } = await supabase.from('сотрудники').select('telegram_id').in('роль', ['Редактор', 'Владелец']).eq('активен', true);
  for (const mg of (m || [])) { try { await bot.api.sendMessage(mg.telegram_id, `↩️ ${emp.имя}: ${ctx.session.data.rtR}`); } catch {} }
  ctx.session.state = null; ctx.session.data = {}; await ctx.reply('✅ Отправлено', { reply_markup: getKB(emp, ctx.session.shift) });
});

bot.hears('🆘 SOS', async (ctx) => {
  const emp = ctx.session.employee;
  const { data: m } = await supabase.from('сотрудники').select('telegram_id').in('роль', ['Редактор', 'Владелец']).eq('активен', true);
  for (const mg of (m || [])) { try { await bot.api.sendMessage(mg.telegram_id, `🚨🚨🚨 ${emp.имя} • ${emp.точки?.название || '?'} • ${timeStr()}`); } catch {} }
  await ctx.reply('🚨 SOS!');
});

// =============================================
// 🔒 ЗАКРЫТЬ СМЕНУ (инвент → фото → недостача → ЗП → выплата)
// =============================================
bot.hears('🔒 Закрыть смену', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️'); ctx.session.state = 'sc_cans'; ctx.session.data = {};
  await ctx.reply(`🔒 ${ctx.session.employee.имя}, закрытие\n\n📦 Банок?`, { reply_markup: { remove_keyboard: true } });
});
bot.on('message:text').filter(c => c.session.state === 'sc_cans', async (ctx) => { const n = parseInt(ctx.message.text); if (isNaN(n) || n < 0) return ctx.reply('#:'); ctx.session.data.ec = n; ctx.session.state = 'sc_soda'; await ctx.reply('🥤 Газировок?'); });
bot.on('message:text').filter(c => c.session.state === 'sc_soda', async (ctx) => { const n = parseInt(ctx.message.text); if (isNaN(n) || n < 0) return ctx.reply('#:'); ctx.session.data.es = n; ctx.session.state = 'sc_cash'; await ctx.reply('💵 Нал?'); });
bot.on('message:text').filter(c => c.session.state === 'sc_cash', async (ctx) => { const n = parseFloat(ctx.message.text); if (isNaN(n) || n < 0) return ctx.reply('₽:'); ctx.session.data.eca = n; ctx.session.state = 'sc_term'; await ctx.reply('🏧 Терминал?'); });
bot.on('message:text').filter(c => c.session.state === 'sc_term', async (ctx) => { const n = parseFloat(ctx.message.text); if (isNaN(n) || n < 0) return ctx.reply('₽:'); ctx.session.data.et = n; ctx.session.state = 'sc_ph1'; await ctx.reply('📷 Чек терминала 1/2:'); });
bot.on('message:photo').filter(c => c.session.state === 'sc_ph1', async (ctx) => { ctx.session.data.tp1 = ctx.message.photo.at(-1).file_id; ctx.session.state = 'sc_ph2'; await ctx.reply('📷 Чек 2/2:'); });
bot.on('message:photo').filter(c => c.session.state === 'sc_ph2', async (ctx) => {
  ctx.session.data.tp2 = ctx.message.photo.at(-1).file_id;
  const kb = new InlineKeyboard().text('✅ Да', 'cl_y').text('❌ Нет', 'cl_n');
  await ctx.reply('🧹 Уборка?', { reply_markup: kb });
});

bot.callbackQuery(/^cl_(y|n)$/, async (ctx) => {
  const cleaned = ctx.match[1] === 'y';
  const emp = ctx.session.employee, sh = ctx.session.shift, d = ctx.session.data;

  // Недостача
  const cansUsed = (sh.банки_начало || 0) - d.ec;
  const shortage = cansUsed - (sh.банок_продано || 0);

  if (shortage > 0) {
    // Недостача — спрашиваем
    ctx.session.data.cleaned = cleaned;
    ctx.session.data.shortage = shortage;
    const deductSum = shortage * CAN_COST;
    const kb = new InlineKeyboard()
      .text('✅ Принимаю вычет', 'short_yes')
      .text('❌ Буду искать', 'short_no');
    await ctx.editMessageText(
      `⚠️ Не хватает ${shortage} шайб × ${CAN_COST}₽ = ${deductSum}₽\n\nБудете находить или принимаете недочёт?`,
      { reply_markup: kb });
    return ctx.answerCallbackQuery();
  }

  // Нет недостачи — завершаем
  ctx.session.data.cleaned = cleaned;
  ctx.session.data.shortage = shortage;
  ctx.session.data.shortageAccepted = false;
  await closeShift(ctx);
  await ctx.answerCallbackQuery();
});

bot.callbackQuery('short_yes', async (ctx) => {
  ctx.session.data.shortageAccepted = true;
  await closeShift(ctx); await ctx.answerCallbackQuery();
});

bot.callbackQuery('short_no', async (ctx) => {
  // Вернуть в меню для исправлений
  ctx.session.data.shortageAccepted = false;
  ctx.session.data.shortageReturned = true;
  await ctx.editMessageText('↩️ Проверьте завершённые заказы и инвентарь.\nКогда готовы — нажмите 🔒 Закрыть смену снова.');
  await ctx.answerCallbackQuery();
  await ctx.reply('Меню:', { reply_markup: getKB(ctx.session.employee, ctx.session.shift) });
  ctx.session.state = null;
});

async function closeShift(ctx) {
  const emp = ctx.session.employee, sh = ctx.session.shift, d = ctx.session.data;
  const shortage = d.shortage || 0;
  const cleaned = d.cleaned;
  const shortageAccepted = d.shortageAccepted || false;

  // ЗП
  const { data: orders } = await supabase.from('заказы')
    .select('итоговая_сумма, комментарий, позиции_в_заказах(количество)')
    .eq('продавец_id', emp.id).eq('статус', 'Завершён')
    .gte('дата_создания', today() + 'T00:00:00');

  const sal = calcSalary(orders || [], emp.зп_база || 2000);

  // Вычет за недостачу
  const deduction = shortageAccepted ? (shortage * CAN_COST) : 0;
  const finalSalary = sal.salary - deduction;

  const expectedCash = (sh.нал_начало || 0) + (sh.выручка_нал_факт || 0) - (sh.доп_траты || 0) - (sh.инкассация || 0);
  const cashDiff = d.eca - expectedCash;

  await supabase.from('смены').update({
    время_закрытия: now(), статус: 'Закрыта',
    банки_конец: d.ec, газировка_конец: d.es, нал_конец: d.eca, терминал_сумма: d.et,
    фото_чека_терминал: [d.tp1, d.tp2].filter(Boolean).join('|'),
    уборка_выполнена: cleaned, недостача_банки: Math.max(0, shortage),
    процент_зп: sal.tier, зп_за_смену: finalSalary,
  }).eq('id', sh.id);

  let r = `🔒 Смена закрыта! ${emp.имя} ${timeStr()}\n\n`;
  r += `📦 Банки: ${sh.банки_начало}→${d.ec} (продано ${sh.банок_продано || 0})`;
  if (shortage > 0) {
    r += `\n⚠️ НЕДОСТАЧА: ${shortage} шайб × ${CAN_COST}₽ = ${shortage * CAN_COST}₽`;
    r += shortageAccepted ? '\n💸 Вычет принят' : '\n🔍 Сотрудник разобрался';
  } else if (shortage < 0) r += `\n✅ Лишних: ${Math.abs(shortage)}`;

  r += `\n🥤 Газ: ${sh.газировка_начало}→${d.es}`;
  r += `\n\n💰 Выручка: ${sh.выручка_общая || 0}₽`;
  r += `\n💵 Нал: ${d.eca}₽ (ожид: ${expectedCash}₽)`;
  if (cashDiff > 0) r += ` ✅+${cashDiff}`;
  else if (cashDiff < 0) r += ` ⚠️${cashDiff}`;
  r += `\n🏧 Терминал: ${d.et}₽`;
  if (sh.инкассация) r += `\n💼 Инк: ${sh.инкассация}₽`;

  r += `\n\n💵 ЗП: ${sal.salary}₽`;
  r += `\n   (${emp.зп_база || 2000} + ${sal.tier}% от ${sal.normalRev}₽`;
  if (sal.wholesaleRev > 0) r += ` + 1.5% от опта ${sal.wholesaleRev}₽`;
  r += `)`;
  r += `\n   Банок: ${sal.totalCans} (карты: ${sal.cardCans}, опт: ${sal.wholesaleCans}, эфф: ${sal.effectiveCans})`;
  if (deduction > 0) r += `\n💸 Вычет: -${deduction}₽ → ИТОГО: ${finalSalary}₽`;
  r += `\n🧹 ${cleaned ? '✅' : '❌'}`;

  // Считаем ВСЕ закрытые смены этого сотрудника (по его ID/имени)
  const { count: shiftCount } = await supabase.from('смены')
    .select('id', { count: 'exact', head: true })
    .eq('сотрудник_id', emp.id).eq('статус', 'Закрыта');

  const canPayout = shiftCount > 0 && shiftCount % 3 === 0;

  ctx.session.shift = null; ctx.session.state = null; ctx.session.data = {};

  if (canPayout) {
    r += `\n\n✅ Это ${shiftCount}-я смена (каждая 3я — выплата)!`;
    ctx.session.state = 'payout';
    await ctx.editMessageText(r);
    await ctx.reply('💰 Сколько забираете?');
  } else {
    const inCycle = shiftCount % 3;
    r += `\n\n⏳ Смена ${inCycle || 3} из 3 (всего: ${shiftCount}). Выплата после 3й.`;
    await ctx.editMessageText(r);
    await ctx.reply('Меню:', { reply_markup: getKB(emp, null) });
  }

  // Отчёт бухгалтеру и владельцу
  const report = r + (shortage > 0 && !shortageAccepted ? '\n⚠️ БЫЛА НЕДОСТАЧА — сотрудник разобрался' : '');
  if (OWNER_ID && emp.telegram_id !== OWNER_ID) { try { await bot.api.sendMessage(OWNER_ID, report); } catch {} }
  const { data: accs } = await supabase.from('сотрудники').select('telegram_id').eq('роль', 'Бухгалтер').eq('активен', true);
  for (const a of (accs || [])) { try { await bot.api.sendMessage(a.telegram_id, report); } catch {} }
}

bot.on('message:text').filter(c => c.session.state === 'payout', async (ctx) => {
  const n = parseFloat(ctx.message.text); if (isNaN(n) || n < 0) return ctx.reply('Сумма:');
  ctx.session.state = null;
  await ctx.reply(`✅ Выплата: ${n}₽`, { reply_markup: getKB(ctx.session.employee, null) });
});

// =============================================
// ВЛАДЕЛЕЦ: топ, статистика, удержания, поступление, перемещение, сотрудники
// =============================================
bot.hears('📈 Топ продаж', async (ctx) => {
  if (ctx.session.employee?.роль !== 'Владелец') return;
  const wa = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const { data: dd } = await supabase.from('позиции_в_заказах').select('количество, товары(название), заказы!inner(дата_создания,статус)').gte('заказы.дата_создания', today() + 'T00:00:00').eq('заказы.статус', 'Завершён');
  const { data: wd } = await supabase.from('позиции_в_заказах').select('количество, товары(название), заказы!inner(дата_создания,статус)').gte('заказы.дата_создания', wa + 'T00:00:00').eq('заказы.статус', 'Завершён');
  function top(rows) { const m = {}; (rows || []).forEach(r => { const n = r.товары?.название || '?'; m[n] = (m[n] || 0) + (r.количество || 0); }); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 10); }
  let t = '📈 ТОП\n\n📅 Сегодня:\n'; top(dd).forEach(([n, c], i) => { t += `${i + 1}. ${n.substring(0, 30)} — ${c}\n`; }); if (!top(dd).length) t += '—\n';
  t += '\n📅 Неделя:\n'; top(wd).forEach(([n, c], i) => { t += `${i + 1}. ${n.substring(0, 30)} — ${c}\n`; }); if (!top(wd).length) t += '—\n';
  await ctx.reply(t);
});

bot.hears('📊 Статистика', async (ctx) => {
  if (ctx.session.employee?.роль !== 'Владелец') return;
  const { data: orders } = await supabase.from('заказы').select('итоговая_сумма, сумма_нал, сумма_безнал, точки(название)').eq('статус', 'Завершён').gte('дата_создания', today() + 'T00:00:00');
  const { data: shifts } = await supabase.from('смены').select('статус, банок_продано, выручка_общая, зп_за_смену, сотрудники(имя), точки(название)').eq('дата', today());
  const rev = (orders || []).reduce((s, o) => s + (o.итоговая_сумма || 0), 0);
  const byPt = {}; (orders || []).forEach(o => { const p = o.точки?.название || '?'; byPt[p] = (byPt[p] || 0) + (o.итоговая_сумма || 0); });
  let t = `📊 ${today()}\n💰 ${rev}₽ | ${(orders || []).length} заказов\n\n🏪:\n`;
  Object.entries(byPt).forEach(([p, s]) => { t += `  ${p}: ${s}₽\n`; });
  t += '\n👥:\n'; (shifts || []).forEach(s => { t += `  ${s.сотрудники?.имя || '?'} (${s.точки?.название || '?'}) ${s.статус} | ${s.банок_продано || 0} бан | ЗП ${s.зп_за_смену || '—'}₽\n`; });
  await ctx.reply(t);
});

bot.hears('💸 Удержания', async (ctx) => {
  if (ctx.session.employee?.роль !== 'Владелец') return;
  const kb = new InlineKeyboard().text('📋', 'ud_list').text('➕', 'ud_new');
  await ctx.reply('💸:', { reply_markup: kb });
});
bot.callbackQuery('ud_list', async (ctx) => {
  const { data: u } = await supabase.from('удержания').select('*, сотрудники!удержания_сотрудник_id_fkey(имя)').eq('статус', 'Активно');
  if (!u?.length) { await ctx.editMessageText('Нет'); return ctx.answerCallbackQuery(); }
  let t = ''; u.forEach(x => { t += `👤 ${x.сотрудники?.имя || '?'} | ${x.причина} | ${x.сумма}₽\n`; });
  await ctx.editMessageText(t); await ctx.answerCallbackQuery();
});
bot.callbackQuery('ud_new', async (ctx) => {
  const { data: e } = await supabase.from('сотрудники').select('id, имя').eq('активен', true).neq('роль', 'Владелец');
  const kb = new InlineKeyboard(); (e || []).forEach(x => kb.text(x.имя, `ude_${x.id}`).row());
  await ctx.editMessageText('Кому?', { reply_markup: kb }); await ctx.answerCallbackQuery();
});
bot.callbackQuery(/^ude_(\d+)$/, async (ctx) => { ctx.session.data.udE = parseInt(ctx.match[1]); ctx.session.state = 'ud_r'; await ctx.editMessageText('Причина:'); await ctx.answerCallbackQuery(); });
bot.on('message:text').filter(c => c.session.state === 'ud_r', async (ctx) => { ctx.session.data.udR = ctx.message.text; ctx.session.state = 'ud_s'; await ctx.reply('Сумма:'); });
bot.on('message:text').filter(c => c.session.state === 'ud_s', async (ctx) => { const n = parseFloat(ctx.message.text); if (isNaN(n)) return ctx.reply('₽:'); ctx.session.data.udS = n; ctx.session.state = 'ud_sh'; await ctx.reply('Смен:'); });
bot.on('message:text').filter(c => c.session.state === 'ud_sh', async (ctx) => {
  const n = parseInt(ctx.message.text); if (isNaN(n) || n < 1) return ctx.reply('#:');
  const d = ctx.session.data;
  await supabase.from('удержания').insert({ сотрудник_id: d.udE, причина: d.udR, сумма: d.udS, сумма_общая: d.udS, смен_для_погашения: n, сумма_за_смену: Math.ceil(d.udS / n), погашено_смен: 0, статус: 'Активно', назначил_id: ctx.session.employee.id });
  ctx.session.state = null; ctx.session.data = {}; await ctx.reply(`✅ ${d.udS}₽/${n} смен`, { reply_markup: getKB(ctx.session.employee, ctx.session.shift) });
});

// 📦 ПОСТУПЛЕНИЕ
bot.hears('📦 Поступление', async (ctx) => {
  if (!isManager(ctx.session.employee)) return;
  const { data: pts } = await supabase.from('точки').select('id, название').eq('активна', true);
  const kb = new InlineKeyboard(); (pts || []).forEach(p => kb.text(`🏪 ${p.название}`, `rcpt_${p.id}`).row());
  ctx.session.data = { recvItems: [] }; await ctx.reply('📦 Точка:', { reply_markup: kb });
});
bot.callbackQuery(/^rcpt_(\d+)$/, async (ctx) => {
  ctx.session.data.rcPt = parseInt(ctx.match[1]);
  const { data: pt } = await supabase.from('точки').select('название').eq('id', ctx.session.data.rcPt).single();
  ctx.session.data.rcPtN = pt?.название; await showRcBr(ctx); await ctx.answerCallbackQuery();
});
async function showRcBr(ctx) {
  const { data } = await supabase.from('товары').select('бренд').eq('активен', true);
  const br = [...new Set((data || []).map(x => x.бренд).filter(Boolean))].sort();
  const kb = new InlineKeyboard(); br.forEach(b => { kb.text(`${brandEmoji(b)} ${b}`, `rcb_${encodeURIComponent(b)}`).row(); }); kb.text('✅ Готово', 'rc_done');
  try { await ctx.editMessageText(`📦→${ctx.session.data.rcPtN}\nМарка:`, { reply_markup: kb }); } catch { await ctx.reply(`📦→${ctx.session.data.rcPtN}\nМарка:`, { reply_markup: kb }); }
}
bot.callbackQuery(/^rcb_(.+)$/, async (ctx) => {
  const brand = decodeURIComponent(ctx.match[1]); ctx.session.data.rcBr = brand;
  const { data } = await supabase.from('товары').select('линейка').eq('бренд', brand).eq('активен', true);
  const lines = [...new Set((data || []).map(x => x.линейка).filter(Boolean))].sort();
  const kb = new InlineKeyboard(); lines.forEach(l => { kb.text(`📋 ${l}`, `rcl_${encodeURIComponent(l)}`).row(); }); kb.text('⬅️', 'rc_tobr').row().text('✅', 'rc_done');
  await ctx.editMessageText(`${brandEmoji(brand)} ${brand}\nЛинейка:`, { reply_markup: kb }); await ctx.answerCallbackQuery();
});
bot.callbackQuery(/^rcl_(.+)$/, async (ctx) => {
  const line = decodeURIComponent(ctx.match[1]); ctx.session.data.rcLn = line;
  const { data: pr } = await supabase.from('товары').select('id, вкус, название').eq('бренд', ctx.session.data.rcBr).eq('линейка', line).eq('активен', true).order('вкус');
  const kb = new InlineKeyboard(); (pr || []).forEach(p => { kb.text(`🔹 ${(p.вкус || p.название).substring(0, 40)}`, `rcf_${p.id}`).row(); }); kb.text('⬅️', `rcbl`).text('⬅️ Марки', 'rc_tobr').row().text('✅', 'rc_done');
  await ctx.editMessageText(`${brandEmoji(ctx.session.data.rcBr)} ${ctx.session.data.rcBr}•${line}\nВкус:`, { reply_markup: kb }); await ctx.answerCallbackQuery();
});
bot.callbackQuery(/^rcf_(\d+)$/, async (ctx) => {
  ctx.session.data.rcP = parseInt(ctx.match[1]);
  const { data: p } = await supabase.from('товары').select('название').eq('id', ctx.session.data.rcP).single();
  ctx.session.data.rcPN = p?.название; ctx.session.state = 'rc_qty';
  await ctx.editMessageText(`📦 ${p?.название}\nКол-во:`); await ctx.answerCallbackQuery();
});
bot.on('message:text').filter(c => c.session.state === 'rc_qty', async (ctx) => {
  const qty = parseInt(ctx.message.text); if (isNaN(qty) || qty < 1) return ctx.reply('#:');
  const d = ctx.session.data;
  const { data: inv } = await supabase.from('инвентарь').select('id, количество').eq('товар_id', d.rcP).eq('точка_id', d.rcPt).single();
  if (inv) await supabase.from('инвентарь').update({ количество: inv.количество + qty, последнее_обновление: now() }).eq('id', inv.id);
  else await supabase.from('инвентарь').insert({ товар_id: d.rcP, точка_id: d.rcPt, количество: qty });
  await supabase.from('движения').insert({ товар_id: d.rcP, точка_куда_id: d.rcPt, тип_операции: 'Поступление', количество: qty, сотрудник_id: ctx.session.employee.id });
  d.recvItems.push({ name: d.rcPN, qty }); ctx.session.state = null;
  await ctx.reply(`✅ +${qty} ${d.rcPN}`); await showRcBr(ctx);
});
bot.callbackQuery('rc_tobr', async (ctx) => { await showRcBr(ctx); await ctx.answerCallbackQuery(); });
bot.callbackQuery('rcbl', async (ctx) => {
  const brand = ctx.session.data.rcBr;
  const { data } = await supabase.from('товары').select('линейка').eq('бренд', brand).eq('активен', true);
  const lines = [...new Set((data || []).map(x => x.линейка).filter(Boolean))].sort();
  const kb = new InlineKeyboard(); lines.forEach(l => { kb.text(`📋 ${l}`, `rcl_${encodeURIComponent(l)}`).row(); }); kb.text('⬅️', 'rc_tobr').row().text('✅', 'rc_done');
  await ctx.editMessageText(`${brandEmoji(brand)} ${brand}\nЛинейка:`, { reply_markup: kb }); await ctx.answerCallbackQuery();
});
bot.callbackQuery('rc_done', async (ctx) => {
  const items = ctx.session.data.recvItems || [];
  let t = `📦→${ctx.session.data.rcPtN || '?'}:\n`; items.forEach(i => { t += `✅ ${i.name.substring(0, 30)} — ${i.qty}\n`; });
  ctx.session.state = null; ctx.session.data = {};
  await ctx.editMessageText(t || 'Пусто'); await ctx.answerCallbackQuery();
  await ctx.reply('Меню:', { reply_markup: getKB(ctx.session.employee, ctx.session.shift) });
});

// 🔄 ПЕРЕМЕЩЕНИЕ
bot.hears('🔄 Перемещение', async (ctx) => {
  if (!isManager(ctx.session.employee)) return;
  const { data: pts } = await supabase.from('точки').select('id, название').eq('активна', true);
  const kb = new InlineKeyboard(); (pts || []).forEach(p => kb.text(`🏪 ${p.название}`, `mvf_${p.id}`).row());
  ctx.session.data = { mvI: [] }; await ctx.reply('🔄 ОТКУДА?', { reply_markup: kb });
});
bot.callbackQuery(/^mvf_(\d+)$/, async (ctx) => {
  ctx.session.data.mF = parseInt(ctx.match[1]);
  const { data: pt } = await supabase.from('точки').select('название').eq('id', ctx.session.data.mF).single(); ctx.session.data.mFN = pt?.название;
  const { data: pts } = await supabase.from('точки').select('id, название').eq('активна', true).neq('id', ctx.session.data.mF);
  const kb = new InlineKeyboard(); (pts || []).forEach(p => kb.text(`🏪 ${p.название}`, `mvt_${p.id}`).row());
  await ctx.editMessageText(`${pt?.название}→?\nКУДА?`, { reply_markup: kb }); await ctx.answerCallbackQuery();
});
bot.callbackQuery(/^mvt_(\d+)$/, async (ctx) => {
  ctx.session.data.mT = parseInt(ctx.match[1]);
  const { data: pt } = await supabase.from('точки').select('название').eq('id', ctx.session.data.mT).single(); ctx.session.data.mTN = pt?.название;
  ctx.session.state = 'mv_s'; await ctx.editMessageText(`🔄 ${ctx.session.data.mFN}→${pt?.название}\n🔍 Товар:`); await ctx.answerCallbackQuery();
});
bot.on('message:text').filter(c => c.session.state === 'mv_s', async (ctx) => {
  const { data: pr } = await supabase.from('товары').select('id, название').ilike('название', `%${ctx.message.text.trim()}%`).eq('активен', true).limit(10);
  if (!pr?.length) return ctx.reply('Не найдено:');
  const kb = new InlineKeyboard(); pr.forEach(p => kb.text(p.название.substring(0, 35), `mvp_${p.id}`).row()); kb.text('✅', 'mv_done');
  await ctx.reply('Выберите товар:', { reply_markup: kb });
});
bot.callbackQuery(/^mvp_(\d+)$/, async (ctx) => {
  ctx.session.data.mvP = parseInt(ctx.match[1]);
  const { data: p } = await supabase.from('товары').select('название').eq('id', ctx.session.data.mvP).single(); ctx.session.data.mvPN = p?.название;
  const { data: inv } = await supabase.from('инвентарь').select('количество').eq('товар_id', ctx.session.data.mvP).eq('точка_id', ctx.session.data.mF).single();
  ctx.session.state = 'mv_q'; await ctx.editMessageText(`${p?.название}\n📍${ctx.session.data.mFN}: ${inv?.количество || 0}\nСколько?`); await ctx.answerCallbackQuery();
});
bot.on('message:text').filter(c => c.session.state === 'mv_q', async (ctx) => {
  const q = parseInt(ctx.message.text); if (isNaN(q) || q < 1) return ctx.reply('#:');
  const d = ctx.session.data;
  const { data: f } = await supabase.from('инвентарь').select('id, количество').eq('товар_id', d.mvP).eq('точка_id', d.mF).single();
  if (f) await supabase.from('инвентарь').update({ количество: Math.max(0, f.количество - q), последнее_обновление: now() }).eq('id', f.id);
  const { data: t } = await supabase.from('инвентарь').select('id, количество').eq('товар_id', d.mvP).eq('точка_id', d.mT).single();
  if (t) await supabase.from('инвентарь').update({ количество: t.количество + q, последнее_обновление: now() }).eq('id', t.id);
  else await supabase.from('инвентарь').insert({ товар_id: d.mvP, точка_id: d.mT, количество: q });
  await supabase.from('движения').insert({ товар_id: d.mvP, точка_откуда_id: d.mF, точка_куда_id: d.mT, тип_операции: 'Перемещение', количество: q, сотрудник_id: ctx.session.employee.id });
  d.mvI.push({ name: d.mvPN, qty: q }); ctx.session.state = 'mv_s';
  const kb = new InlineKeyboard().text('✅', 'mv_done');
  await ctx.reply(`✅ ${d.mvPN}×${q}: ${d.mFN}→${d.mTN}`, { reply_markup: kb });
});
bot.callbackQuery('mv_done', async (ctx) => {
  const d = ctx.session.data; let t = `🔄 ${d.mFN}→${d.mTN}:\n`; (d.mvI || []).forEach(i => { t += `✅ ${i.name.substring(0, 30)}—${i.qty}\n`; });
  ctx.session.state = null; ctx.session.data = {}; await ctx.editMessageText(t); await ctx.answerCallbackQuery();
  await ctx.reply('Меню:', { reply_markup: getKB(ctx.session.employee, ctx.session.shift) });
});

// 📋 ЗАКАЗЫ (входящие) | 📝 ЗАДАЧИ | 👥 СОТРУДНИКИ | ➕👤
bot.hears('📋 Заказы', async (ctx) => {
  const emp = ctx.session.employee;
  const filter = emp.роль !== 'Владелец' && emp.точка_id ? { точка_id: emp.точка_id } : {};
  const { data: o } = await supabase.from('заказы').select('*, клиенты(имя)').match(filter).in('статус', ['Новый', 'Подтверждён', 'Готов']).order('дата_создания').limit(10);
  if (!o?.length) return ctx.reply('✅ Нет');
  for (const x of o) { const kb = new InlineKeyboard().text('✅', `or_${x.id}`).text('🤝', `od_${x.id}`).text('❌', `oc_${x.id}`); await ctx.reply(`${x.номер_заказа} | ${x.клиенты?.имя || '?'} | ${x.итоговая_сумма}₽`, { reply_markup: kb }); }
});
bot.callbackQuery(/^o(r|d|c)_(\d+)$/, async (ctx) => {
  const m = { r: 'Готов', d: 'Завершён', c: 'Отменён' }; await supabase.from('заказы').update({ статус: m[ctx.match[1]] }).eq('id', parseInt(ctx.match[2]));
  await ctx.editMessageText(ctx.msg.text + `→${m[ctx.match[1]]}`); await ctx.answerCallbackQuery();
});

bot.hears('📝 Задачи', async (ctx) => {
  const { data: t } = await supabase.from('задачи').select('*').eq('исполнитель_id', ctx.session.employee.id).in('статус', ['Новая', 'В работе']);
  if (!t?.length) return ctx.reply('✅'); let r = '📝:\n'; t.forEach(x => { r += `${x.статус === 'Новая' ? '🆕' : '🔄'} ${x.описание}\n`; }); await ctx.reply(r);
});

bot.hears('👥 Сотрудники', async (ctx) => {
  if (ctx.session.employee?.роль !== 'Владелец') return;
  const { data: e } = await supabase.from('сотрудники').select('*, точки(название)').eq('активен', true);
  const ROLE_EMOJI = {'Продавец':'🏪','Курьер':'🚗','Редактор':'✏️','Бухгалтер':'📊','Владелец':'👑'};
  let t = `👥 (${(e || []).length}):\n\n`; (e || []).forEach(x => { t += `${ROLE_EMOJI[x.роль] || '👤'} ${x.имя}—${x.роль} | ${x.точки?.название || '—'} | ${x.telegram_id}\n`; }); await ctx.reply(t);
});

bot.hears('➕👤 Сотрудник', async (ctx) => {
  if (ctx.session.employee?.роль !== 'Владелец') return;
  ctx.session.state = 'ae_tg'; await ctx.reply('📱 TG ID:', { reply_markup: { remove_keyboard: true } });
});
bot.on('message:text').filter(c => c.session.state === 'ae_tg', async (ctx) => { const n = parseInt(ctx.message.text); if (isNaN(n)) return ctx.reply('#:'); ctx.session.data.aT = n; ctx.session.state = 'ae_n'; await ctx.reply('Имя:'); });
bot.on('message:text').filter(c => c.session.state === 'ae_n', async (ctx) => {
  ctx.session.data.aN = ctx.message.text; ctx.session.state = 'ae_r';
  await ctx.reply('Роль:', { reply_markup: new InlineKeyboard().text('🏪', 'ar_Продавец').text('🚗', 'ar_Курьер').text('✏️', 'ar_Редактор').text('📊', 'ar_Бухгалтер') });
});
bot.callbackQuery(/^ar_(.+)$/, async (ctx) => {
  ctx.session.data.aR = ctx.match[1];
  const { data: pts } = await supabase.from('точки').select('id, название').eq('активна', true);
  const kb = new InlineKeyboard(); (pts || []).forEach(p => kb.text(p.название, `ap_${p.id}`).row()); kb.text('—', 'ap_0');
  await ctx.editMessageText('Точка:'); await ctx.reply('Выберите:', { reply_markup: kb }); await ctx.answerCallbackQuery();
});
bot.callbackQuery(/^ap_(\d+)$/, async (ctx) => {
  const d = ctx.session.data;
  const { error } = await supabase.from('сотрудники').insert({ telegram_id: d.aT, имя: d.aN, роль: d.aR, точка_id: parseInt(ctx.match[1]) || null, активен: true, зп_база: 2000 });
  if (error) { await ctx.answerCallbackQuery(); return ctx.editMessageText(`❌ ${error.message}`); }
  ctx.session.state = null; ctx.session.data = {};
  await ctx.editMessageText(`✅ ${d.aN}—${d.aR}`); await ctx.answerCallbackQuery();
});

// =============================================
bot.hears(/^─+/, () => {});
bot.on('message:text', async (ctx) => { if (ctx.session.state) return ctx.reply('⚠️ /start'); });
bot.catch((err) => console.error('Bot error:', err));
bot.start({ onStart: () => console.log('🤖 TTS Staff Bot v5!') });
