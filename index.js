const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const mongoose = require('mongoose');
const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config');
const Token = require('./models/Token'); // استيراد نموذج Token
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

function startBot(token, prefix = '!') {
  const bot = new Client({ intents: 131071, });

  bot.login(token)
    .then(() => {
      activeBots[token] = { bot, prefix };

      
      bot.on('messageCreate', async (message) => {
        if (!message.content.startsWith(prefix) || message.author.bot) return;

        
        const args = message.content.slice(prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        if (command === 'bc') {
          if (!message.member.permissions.has('Administrator')) {
    return message.channel.send('ليس لديك الإذن لاستخدام هذا الأمر. هذا الأمر مخصص للمسؤولين فقط.');
          }
          const broadcastMessage = args.join(' ');
          if (!broadcastMessage) {
            return message.channel.send('Please provide a message to broadcast.');
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
    return message.channel.send('ليس لديك الإذن لاستخدام هذا الأمر. هذا الأمر مخصص للمسؤولين فقط.');
          }
          const newName = args.join(' ');
          if (!newName) {
            return message.channel.send('يرجى تقديم اسم جديد للبوت.');
          }

          try {
            await bot.user.setUsername(newName);
            message.channel.send(`تم تغيير اسم البوت إلى **${newName}**`);
          } catch (err) {
            message.channel.send('فشل في تغيير الاسم. تأكد من أن الاسم يتوافق مع متطلبات Discord.');
            console.error('Error changing bot name:', err);
          }
        } else if (command === 'set-avatar') {
          if (!message.member.permissions.has('Administrator')) {
    return message.channel.send('ليس لديك الإذن لاستخدام هذا الأمر. هذا الأمر مخصص للمسؤولين فقط.');
          }
  const avatarUrl = args[0];

  if (!avatarUrl) {
    return message.channel.send('يرجى تقديم URL لصورة جديدة.');
  }

  try {
    await bot.user.setAvatar(avatarUrl);
    message.channel.send('تم تغيير صورة البروفايل بنجاح!');
  } catch (err) {
    message.channel.send('فشل في تغيير صورة البروفايل. تأكد من أن URL صالح.');
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
    - **ID:** ${botId}
    - **عدد السيرفرات:** ${guildCount}
    - **البريفيكس:** ${botPrefix}
  `;

  message.channel.send(infoMessage);
        }
      });
    })
    .catch((err) => {
      console.error(`Failed to login with token ${token}:`, err);
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

app.post('/edit-token', (req, res) => {
    const botId = req.body.id;
    const newPrefix = req.body.prefix;

    Token.findOneAndUpdate({ id: botId }, { prefix: newPrefix }, { new: true })
        .then(updatedToken => {
            if (updatedToken) {
                // منطق لتحديث البوت النشط إذا كان قيد التشغيل
            }
            res.redirect('/');
        })
        .catch(err => {
            console.error('Error updating prefix:', err);
            res.redirect('/?error=Failed to update prefix');
        });
});



app.post('/delete-token', (req, res) => {
  const botId = req.body.id;

  Token.findOneAndDelete({ id: botId })
    .then(deletedToken => {
      if (deletedToken) {
        stopBot(deletedToken.token);
      }
      res.redirect('/');
    })
    .catch(err => {
      console.error('Error deleting token:', err);
      res.redirect('/?error=Failed to delete token');
    });
});

app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000');
  startAllBots();
});
           
