const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');

const app = express();

// servidor HTTP (necessário pro Render + UptimeRobot)
app.get('/', (req, res) => res.send('Bot online!'));

app.listen(process.env.PORT || 3000, () => {
  console.log('Servidor HTTP rodando');
});

// cliente Discord
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// variáveis de ambiente
const CHANNEL_ID = process.env.CHANNEL_ID;
const TOKEN = process.env.DISCORD_TOKEN;

// intervalo (30 minutos)
const INTERVALO = 30 * 60 * 1000;

let ultimaMensagem = null;

// verifica horário (07:10 até 23:10 Brasil)
function dentroDoHorario() {
  const agora = new Date();
  const totalMinutos = ((agora.getUTCHours() - 3 + 24) % 24) * 60 + agora.getUTCMinutes();
  return totalMinutos >= 430 && totalMinutos < 1390;
}

// embed
function criarEmbed() {
  return new EmbedBuilder()
    .setColor(0x00FF7F)
    .setTitle('⚡ STATUS DO SERVIDOR ⚡')
    .setThumbnail('https://cdn.discordapp.com/attachments/1491994128190410822/1492631762541740234/ChatGPT_Image_11_de_abr._de_2026_18_04_53.png')
    .addFields(
      { name: '🟢 Situação', value: '**ONLINE** — Servidor ativo e rodando!', inline: false },
      { name: '🌐 Endereço', value: '`BlueMacaw.enderman.cloud`', inline: true },
      { name: '🔌 Porta', value: '`28753`', inline: true },
      { name: '⚙️ Plataforma', value: '🧱 Bedrock', inline: true },
      { name: '🧩 Versão', value: '🚀 1.26.14.1', inline: true },
      { name: '📢 Status atual', value: '🛠️ Em constante evolução!\n💡 Novidades chegando...', inline: false },
      { name: '🌟 Bora jogar?', value: '👾 Entre agora e chame seus amigos!', inline: false }
    )
    .setFooter({ text: 'Atualizado em' })
    .setTimestamp();
}

// envia mensagem
async function enviarMensagem() {
  if (!dentroDoHorario()) {
    console.log('Fora do horário, pulando...');
    return;
  }

  try {
    const canal = await client.channels.fetch(CHANNEL_ID);

    if (!canal) {
      console.log('Canal não encontrado!');
      return;
    }

    if (ultimaMensagem) {
      await ultimaMensagem.delete().catch(() => null);
    }

    ultimaMensagem = await canal.send({ embeds: [criarEmbed()] });
    console.log('Mensagem enviada!');
  } catch (err) {
    console.error('Erro ao enviar mensagem:', err);
  }
}

// quando o bot ligar
client.once('ready', async () => {
  console.log(`Bot online como ${client.user.tag}`);

  try {
    const canal = await client.channels.fetch(CHANNEL_ID);

    if (!canal) {
      console.log('Canal não encontrado!');
      return;
    }

    const mensagens = await canal.messages.fetch({ limit: 20 });
    const doBot = mensagens.filter(m => m.author.id === client.user.id);

    await Promise.all(doBot.map(m => m.delete()));

    enviarMensagem();
    setInterval(enviarMensagem, INTERVALO);

  } catch (err) {
    console.error('Erro ao iniciar:', err);
  }
});

// login
client.login(TOKEN);
