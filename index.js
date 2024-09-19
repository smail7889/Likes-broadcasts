const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const fs = require('fs');
const { Client, GatewayIntentBits } = require('discord.js');
const path = require('path');
const config = require('./config')
const app = express();
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: 'some random secret',
  resave: false,
  saveUninitialized: false,
}));

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

const tokensFilePath = path.join(__dirname, 'database/tokens.json');

function loadTokens() {
  if (!fs.existsSync(tokensFilePath)) {
    fs.writeFileSync(tokensFilePath, '[]');
  }
  return JSON.parse(fs.readFileSync(tokensFilePath));
}

function saveTokens(tokens) {
  fs.writeFileSync(tokensFilePath, JSON.stringify(tokens, null, 2));
}

const activeBots = {};
const allowedUserIds = ['915689279605342218', 'YOUR_USER_ID_2']; // Add allowed Discord user IDs here

function startBot(token, prefix = '!') {
  const bot = new Client({ intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ] });

  bot.login(token)
    .then(() => {
      activeBots[token] = { bot, prefix };

      bot.on('messageCreate', async (message) => {
        if (!message.content.startsWith(prefix) || message.author.bot) return;

        const args = message.content.slice(prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        if (command === 'bc') {
          const broadcastMessage = args.join(' ');

          if (!broadcastMessage) {
            return message.channel.send('Please provide a message to broadcast.');
          }

          let progressMessage = await message.channel.send(`**جاري الإرسال ...**
- **تم الإرسال إلى : \`0\`**
- **فشل الارسال الى \`0\`**`);

          let successCount = 0;
          let failureCount = 0;

          const members = await message.guild.members.fetch();

          for (const member of members.values()) {
            if (!member.user.bot) {
              try {
                await member.send(`${broadcastMessage}\n\n${member}`);
                successCount++;
              } catch (err) {
                failureCount++;
              }

              await progressMessage.edit(`**جاري الإرسال ...**
- **تم الإرسال إلى : \`${successCount}\`**
- **فشل الارسال الى : \`${failureCount}\`**`);
            }
          }

          const resultMessage = `
** تم الانتهاء من الارسال | ✅**
**__النتائج :__**
- **تم الارسال الى : \`${successCount}\`**
- **فشل الارسال الى : \`${failureCount}\`**
          `;

          await progressMessage.edit(resultMessage);
        }  else if (command === 'set-name') {
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
  const tokens = loadTokens();
  tokens.forEach(botData => {
    startBot(botData.token, botData.prefix);
  });

  console.log(`Total bots running: ${Object.keys(activeBots).length}`);
}

app.get('/', (req, res) => {
  
  const tokens = loadTokens();
  res.render('index', { user: req.user, tokens, error: req.query.error || null });
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
      const botData = {
        token,
        name: bot.user.username,
        id: bot.user.id,
        prefix
      };

      const tokens = loadTokens();
      tokens.push(botData);
      saveTokens(tokens);

      startBot(token, prefix);
      bot.destroy();
      res.redirect('/');
    })
    .catch(() => {
      res.redirect('/?error=Invalid Token');
    });
});

app.post('/delete-token', (req, res) => {
  const botId = req.body.id;

  let tokens = loadTokens();
  const tokenIndex = tokens.findIndex(token => token.id === botId);

  if (tokenIndex !== -1) {
    const token = tokens[tokenIndex].token;
    stopBot(token);
    tokens.splice(tokenIndex, 1);
    saveTokens(tokens);
  }

  res.redirect('/');
});

app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000');
  startAllBots();
});
