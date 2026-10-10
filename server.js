const express = require('express');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuration
const BOT_TOKEN = '8627886019:AAFBUWWGfB_QMRv_183_P1pMcm_hDqkS-Ns';
const ADMIN_CHAT_ID = '8151857152';
const MONGO_URI = 'mongodb+srv://tamimqwer1234hh_db_user:12UnFTMtj1yk1nT@cluster0.wais3o6.mongodb.net/mintflow?retryWrites=true&w VeryAppName=Cluster0';
const PORT = process.env.PORT || 3000;

// Connect to MongoDB
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected Successfully!'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// User Schema
const userSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true },
  name: String,
  balance: { type: Number, default: 0 },
  package: { type: String, default: 'Normal' }, // Normal, Gold, VIP
  referredBy: { type: String, default: null },
  referralsCount: { type: Number, default: 0 },
  dailyAdsWatched: { type: Number, default: 0 },
  lastAdDate: { type: String, default: '' }
});

const User = mongoose.model('User', userSchema);

// Withdrawal Schema
const withdrawSchema = new mongoose.Schema({
  userId: String,
  telegramId: String,
  amount: Number,
  method: String,
  accountNumber: String,
  status: { type: String, default: 'Pending' },
  createdAt: { type: Date, default: Date.now }
});

const Withdrawal = mongoose.model('Withdrawal', withdrawSchema);

// Telegram Bot Init
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Start Command & Referral Handling
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id.toString();
  const name = msg.from.first_name || 'User';
  const referrerId = match ? match[1] : null;

  let user = await User.findOne({ telegramId: chatId });

  if (!user) {
    let validReferrer = null;
    if (referrerId && referrerId !== chatId) {
      const refUser = await User.findOne({ telegramId: referrerId });
      if (refUser) {
        validReferrer = referrerId;
        refUser.referralsCount += 1;
        await refUser.save();
      }
    }

    user = new User({
      telegramId: chatId,
      name: name,
      referredBy: validReferrer
    });
    await user.save();
  }

  bot.sendMessage(chatId, `স্বাগতম 𝗠𝗜𝗡𝗧𝗙𝗟𝗢𝗪 - 𝗥𝗘𝗪𝗔𝗥𝗗 𝗛𝗨𝗕 এ! 🔥\n\nনিচের বাটনে চাপ দিয়ে অ্যাপটি খুলুন এবং ইনকাম শুরু করুন:`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 Open Mini App", web_app: { url: `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost:' + PORT}` } }]
      ]
    }
  });
});

// Admin Approval / Rejection Handling
bot.on('callback_query', async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;

  if (chatId.toString() !== ADMIN_CHAT_ID) return;

  if (data.startsWith('approve_') || data.startsWith('reject_')) {
    const [action, withdrawId] = data.split('_');
    const withdrawal = await Withdrawal.findById(withdrawId);

    if (!withdrawal || withdrawal.status !== 'Pending') {
      return bot.answerCallbackQuery(query.id, { text: 'এই রিকোয়েস্টটি আগেই প্রসেস করা হয়েছে!' });
    }

    if (action === 'approve') {
      withdrawal.status = 'Approved';
      await withdrawal.save();
      bot.sendMessage(withdrawal.telegramId, `✅ আপনার ${withdrawal.amount} টাকার উইথড্র রিকোয়েস্টটি সফলভাবে এপ্রুভ করা হয়েছে!`);
      bot.editMessageText(`✅ APPROVED: ${withdrawal.amount} BDT for User ID: ${withdrawal.telegramId}`, {
        chat_id: chatId,
        message_id: query.message.message_id
      });
    } else {
      withdrawal.status = 'Rejected';
      await withdrawal.save();
      // Refund balance
      await User.findOneAndUpdate({ telegramId: withdrawal.telegramId }, { $inc: { balance: withdrawal.amount } });
      bot.sendMessage(withdrawal.telegramId, `❌ আপনার ${withdrawal.amount} টাকার উইথড্র রিকোয়েস্টটি রিজেক্ট করা হয়েছে এবং ব্যালেন্স ফেরত দেওয়া হয়েছে।`);
      bot.editMessageText(`❌ REJECTED: ${withdrawal.amount} BDT for User ID: ${withdrawal.telegramId}`, {
        chat_id: chatId,
        message_id: query.message.message_id
      });
    }
  }
});

// API Endpoints for Mini App Frontend
app.get('/api/user/:id', async (req, res) => {
  try {
    let user = await User.findOne({ telegramId: req.params.id });
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    // Reset daily ad limit if new day
    const today = new Date().toISOString().split('T')[0];
    if (user.lastAdDate !== today) {
      user.dailyAdsWatched = 0;
      user.lastAdDate = today;
      await user.save();
    }

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Watch Ad API
app.post('/api/watch-ad', async (req, res) => {
  const { telegramId } = req.body;
  const user = await User.findOne({ telegramId });

  if (!user) return res.status(404).json({ error: 'User not found' });

  const today = new Date().toISOString().split('T')[0];
  if (user.lastAdDate !== today) {
    user.dailyAdsWatched = 0;
    user.lastAdDate = today;
  }

  let maxAds = 300;
  let reward = 1.0;

  if (user.package === 'Gold') {
    maxAds = 250;
    reward = 2.5;
  } else if (user.package === 'VIP') {
    maxAds = 200;
    reward = 5.0;
  }

  if (user.dailyAdsWatched >= maxAds) {
    return res.status(400).json({ error: `আজকের দৈনিক অ্যাডের সীমা (${maxAds}) শেষ হয়ে গেছে!` });
  }

  user.dailyAdsWatched += 1;
  user.balance += reward;
  await user.save();

  res.json({ success: true, balance: user.balance, dailyAdsWatched: user.dailyAdsWatched });
});

// Buy Package API
app.post('/api/buy-package', async (req, res) => {
  const { telegramId, packageType } = req.body;
  const user = await User.findOne({ telegramId });

  if (!user) return res.status(404).json({ error: 'User not found' });

  user.package = packageType;
  await user.save();

  res.json({ success: true, package: user.package });
});

// Withdrawal API
app.post('/api/withdraw', async (req, res) => {
  const { telegramId, amount, method, accountNumber } = req.body;
  const user = await User.findOne({ telegramId });

  if (!user) return res.status(404).json({ error: 'User not found' });

  let minWithdraw = 870;
  let minReferrals = 5;

  if (user.package === 'Gold') {
    minWithdraw = 960;
    minReferrals = 3;
  } else if (user.package === 'VIP') {
    minWithdraw = 1200;
    minReferrals = 1;
  }

  if (amount < minWithdraw) {
    return res.status(400).json({ error: `আপনার প্যাকেজের জন্য মিনিমাম উইথড্র ${minWithdraw} টাকা!` });
  }

  if (user.balance < amount) {
    return res.status(400).json({ error: 'আপনার একাউন্টে পর্যাপ্ত ব্যালেন্স নেই!' });
  }

  if (user.referralsCount < minReferrals) {
    return res.status(400).json({ error: `উইথড্র করার জন্য অন্তত ${minReferrals} টি রেফার সম্পূর্ণ করতে হবে! আপনার রেফার আছে: ${user.referralsCount}` });
  }

  // Deduct Balance & Create Withdrawal Request
  user.balance -= amount;
  await user.save();

  const withdrawal = new Withdrawal({
    userId: user._id,
    telegramId,
    amount,
    method,
    accountNumber
  });
  await withdrawal.save();

  // Send Alert to Admin Chat
  bot.sendMessage(ADMIN_CHAT_ID, 
    `📥 *নতুন উইথড্র রিকোয়েস্ট!*\n\n` +
    `👤 *ইউজার ID:* \`${telegramId}\`\n` +
    `📦 *প্যাকেজ:* ${user.package}\n` +
    `💰 *পরিমাণ:* ${amount} BDT\n` +
    `💳 *মেথড:* ${method}\n` +
    `📱 *একাউন্ট নম্বর:* \`${accountNumber}\`\n` +
    `👥 *মোট রেফার:* ${user.referralsCount}`, 
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Approve", callback_data: `approve_${withdrawal._id}` },
            { text: "❌ Reject", callback_data: `reject_${withdrawal._id}` }
          ]
        ]
      }
    }
  );

  res.json({ success: true, message: 'উইথড্র রিকোয়েস্ট সফলভাবে পাঠানো হয়েছে!' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
