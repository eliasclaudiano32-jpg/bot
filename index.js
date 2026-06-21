const {
  Client, GatewayIntentBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  SlashCommandBuilder
} = require('discord.js');
const fs = require('fs');
const {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, getVoiceConnection,
  NoSubscriberBehavior, entersState
} = require('@discordjs/voice');
const { DisTube } = require('distube');
const { YtDlpPlugin } = require('@distube/yt-dlp');

console.log('✅ Sistema de música via DisTube iniciado.');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates  // ← OBRIGATÓRIO para o bot entrar em calls
  ]
});

const PREFIX = ';';

// ─────────────────────────────────────────────────────────────
// CONFIGURAÇÕES — EDITE AQUI
// ─────────────────────────────────────────────────────────────

const EVENTO_CHANNEL_ID   = '1507052201552384030';
const TICKET_PRICE        = 7000;
const EVENTO_INTERVALO_MS = 2 * 60 * 60 * 1000;
const MOEDAS_POR_CICLO    = 10;

const LISTA_ROLE_ID_1 = '1466981472975196465';
const LISTA_ROLE_ID_2 = '1465825068897669201';

// ─────────────────────────────────────────────────────────────
// CONFIGURAÇÕES DE VERIFICAÇÃO — EDITE AQUI
// ─────────────────────────────────────────────────────────────

// IDs dos dois cargos que serão dados automaticamente ao verificar
const VERIFICACAO_CARGO_ID_1 = '1508688259486711943';
const VERIFICACAO_CARGO_ID_2 = '1508688259486711945';

// Canal onde os logs de verificação serão enviados
const VERIFICACAO_LOG_CHANNEL_ID = '1508890938125189140';

// ─────────────────────────────────────────────────────────────
// CONFIGURAÇÕES DE PERSONAGEM — EDITE AQUI
// ─────────────────────────────────────────────────────────────

// Canal onde as fichas de personagem criadas via /criar-personagem serão enviadas
const PERSONAGEM_CHANNEL_ID = '1508688267569266712';

// ─────────────────────────────────────────────────────────────
// SISTEMA DE MÚSICA COM DISTUBE
// ─────────────────────────────────────────────────────────────
let distube = null; // inicializado após client ready

// ─────────────────────────────────────────────────────────────
// BANCO DE DADOS LOCAL (JSON)
// ─────────────────────────────────────────────────────────────

const DB_FILE = './dados.json';

function carregarDados() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) { console.error('Erro ao carregar dados:', e.message); }
  return { moedas: {}, listaEvento: [] };
}

function salvarDados(dados) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(dados, null, 2), 'utf8'); }
  catch (e) { console.error('Erro ao salvar dados:', e.message); }
}

let db = carregarDados();

function getMoedas(userId)            { return db.moedas[userId] || 0; }
function setMoedas(userId, valor)     { db.moedas[userId] = valor; salvarDados(db); }
function adicionarMoedas(userId, qtd) { db.moedas[userId] = (db.moedas[userId] || 0) + qtd; salvarDados(db); }

// ─────────────────────────────────────────────────────────────
// UTILITÁRIOS
// ─────────────────────────────────────────────────────────────

function getColorFromUsername(username) {
  const colors = [0xE74C3C,0xE67E22,0xF1C40F,0x2ECC71,0x1ABC9C,0x3498DB,0x9B59B6,0xE91E63,0x00BCD4,0xFF5722,0x8BC34A,0x607D8B];
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function formatarMoedas(valor) { return valor.toLocaleString('pt-BR'); }

function temPermissao(member) {
  return member.roles.cache.has(LISTA_ROLE_ID_1) || member.roles.cache.has(LISTA_ROLE_ID_2);
}

async function negarAcesso(message) {
  try { await message.delete(); } catch {}
  const m = await message.channel.send({ embeds: [
    new EmbedBuilder().setColor(0xED4245)
      .setTitle('🔒 Acesso Negado')
      .setDescription('Você não possui o cargo necessário para utilizar este comando.')
      .setFooter({ text: 'Se acredita que isso é um erro, contate um administrador.' })
  ]});
  setTimeout(() => m.delete().catch(() => {}), 6000);
}

// ─────────────────────────────────────────────────────────────
// MAPA DE TIPOS DE EVENTO
// ─────────────────────────────────────────────────────────────

const TIPOS_EVENTO = {
  evento_torneio:    { nome: '🎮 Torneio',             cor: 0x3498DB },
  evento_sorteio:    { nome: '🎁 Sorteio',             cor: 0x2ECC71 },
  evento_competicao: { nome: '🏆 Competição',          cor: 0xED4245 },
  evento_festa:      { nome: '🎉 Festa / Celebração',  cor: 0xF1C40F },
  evento_anuncio:    { nome: '📢 Anúncio Especial',    cor: 0xEB459E },
  evento_guerra:     { nome: '⚔️ Guerra PvP',          cor: 0xE74C3C },
  evento_musical:    { nome: '🎵 Evento Musical',      cor: 0x9B59B6 },
  evento_especial:   { nome: '🌟 Evento Especial',     cor: 0xF1C40F }
};

// ─────────────────────────────────────────────────────────────
// REGRAS PADRÃO POR TIPO DE EVENTO
// ─────────────────────────────────────────────────────────────

const REGRAS_PADRAO = {
  evento_torneio: `1. Respeite todos os participantes e staff
2. Não é permitido uso de trapaças ou hacks
3. Os participantes devem estar presentes no horário marcado
4. Eliminações seguirão o formato de chave eliminatória
5. Decisões do staff são definitivas e irrecorríveis`,

  evento_sorteio: `1. Cada participante tem direito a apenas 1 entrada no sorteio
2. O sorteio será realizado ao vivo e de forma transparente
3. O ganhador terá 24h para reivindicar o prêmio
4. Não é permitida a participação de bots ou contas falsas
5. O staff reserva o direito de desclassificar participantes`,

  evento_competicao: `1. Respeito mútuo entre todos os competidores é obrigatório
2. Qualquer forma de trapaça resultará em desclassificação imediata
3. Todos devem comparecer no horário definido
4. Em caso de empate, haverá rodada extra de desempate
5. A decisão dos juízes é final e não admite recursos`,

  evento_festa: `1. Respeite todos os membros presentes
2. Conteúdo impróprio não será tolerado
3. Siga as orientações do staff durante o evento
4. Divirta-se com responsabilidade
5. Qualquer comportamento inadequado resultará em remoção`,

  evento_anuncio: `1. Leia o anúncio com atenção antes de tirar dúvidas
2. Utilize o canal adequado para perguntas
3. Não envie mensagens fora do tema do anúncio
4. Respeite as decisões da administração
5. Informações complementares serão divulgadas em breve`,

  evento_guerra: `1. Apenas membros do clã registrados podem participar
2. Ataques devem ser coordenados com o líder de guerra
3. Não atacar bases já destruídas sem autorização
4. Respeite a estratégia definida pelo staff
5. Abandonar a guerra sem aviso acarretará punições`,

  evento_musical: `1. Respeite o artista e os outros espectadores
2. Não interrompa as apresentações
3. Comportamento inadequado resultará em remoção
4. Siga as orientações do staff durante o evento
5. Aproveite e divirta-se!`,

  evento_especial: `1. Respeite todos os participantes e staff
2. Siga todas as orientações divulgadas para este evento
3. Não é permitido compartilhar informações do evento externamente
4. Qualquer violação das regras resultará em desclassificação
5. Decisões do staff são definitivas`
};

// ─────────────────────────────────────────────────────────────
// LISTA DE ESTADOS DO BRASIL (para autocomplete)
// ─────────────────────────────────────────────────────────────

const ESTADOS_BRASIL = [
  'Acre', 'Alagoas', 'Amapá', 'Amazonas', 'Bahia', 'Ceará',
  'Distrito Federal', 'Espírito Santo', 'Goiás', 'Maranhão',
  'Mato Grosso', 'Mato Grosso do Sul', 'Minas Gerais', 'Pará',
  'Paraíba', 'Paraná', 'Pernambuco', 'Piauí', 'Rio de Janeiro',
  'Rio Grande do Norte', 'Rio Grande do Sul', 'Rondônia', 'Roraima',
  'Santa Catarina', 'São Paulo', 'Sergipe', 'Tocantins'
];

// ─────────────────────────────────────────────────────────────
// SLASH COMMAND: /criar-personagem
// ─────────────────────────────────────────────────────────────

const comandoCriarPersonagem = new SlashCommandBuilder()
  .setName('rg')
  .setDescription('Crie a ficha do seu personagem')
  .addStringOption(option =>
    option.setName('nome_sobrenome')
      .setDescription('Nome e sobrenome do personagem')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('data_nascimento')
      .setDescription('Data de nascimento (ex: 15/03/1995)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('naturalidade')
      .setDescription('Naturalidade do personagem (ex: Salvador)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('sexo')
      .setDescription('Sexo do personagem')
      .setRequired(true)
      .addChoices(
        { name: 'Masculino', value: 'Masculino' },
        { name: 'Feminino', value: 'Feminino' }
      )
  )
  .addAttachmentOption(option =>
    option.setName('foto_3x4')
      .setDescription('Foto 3x4 do personagem (imagem)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('estado')
      .setDescription('Estado do personagem (digite para filtrar)')
      .setRequired(true)
      .setAutocomplete(true)
  );

// ─────────────────────────────────────────────────────────────
// BOT PRONTO
// ─────────────────────────────────────────────────────────────

client.once('clientReady', async (c) => {
  console.log('Bot conectado como ' + c.user.tag);

  // Inicializa DisTube
  distube = new DisTube(client, {
    plugins: [new YtDlpPlugin({ update: false })],
    emitNewSongOnly: true,
    joinNewVoiceChannel: false,
  });

  distube.on('playSong', (queue, song) => {
    const embed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('🎵  Tocando Agora')
      .setDescription('[' + song.name + '](' + song.url + ')')
      .addFields(
        { name: '🎤 Pedido por', value: song.user?.username || 'Alguém', inline: true },
        { name: '📋 Na fila', value: '**' + (queue.songs.length - 1) + '** música(s)', inline: true }
      )
      .setFooter({ text: 'Use ;Music skip | ;Music stop | ;Music fila' })
      .setTimestamp();
    queue.textChannel?.send({ embeds: [embed] }).catch(() => {});
  });

  distube.on('error', (channel, e) => {
    console.error('Erro DisTube:', e.message);
    channel?.send('❌ Erro ao tocar: ' + e.message).catch(() => {});
  });

  iniciarEventoMoedas();

  // Registra o slash command /RG em todos os servidores
  try {
    for (const guild of c.guilds.cache.values()) {
      await guild.commands.create(comandoCriarPersonagem);
    }
    console.log('Slash command /RG registrado com sucesso.');
  } catch (e) {
    console.error('Erro ao registrar slash command:', e.message);
  }
});

// ─────────────────────────────────────────────────────────────
// EVENTO: MOEDAS A CADA 2 HORAS
// ─────────────────────────────────────────────────────────────

async function iniciarEventoMoedas() {
  setInterval(async () => {
    try {
      const canal = await client.channels.fetch(EVENTO_CHANNEL_ID).catch(() => null);
      if (!canal) { console.error('Canal de evento não encontrado.'); return; }

      const guild = canal.guild;
      await guild.members.fetch();
      const membros = guild.members.cache.filter(m => !m.user.bot);
      membros.forEach(membro => adicionarMoedas(membro.user.id, MOEDAS_POR_CICLO));

      const embed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('💰  Distribuição de Moedas!')
        .setDescription(
          '✨ Todos os membros acabaram de receber **' + MOEDAS_POR_CICLO + ' moedas**!\n\n' +
          'Para ver seu saldo use:\n```\n;Saldo\n```\n' +
          'Acumule moedas e compre seu ticket com **`;Buy ' + formatarMoedas(TICKET_PRICE) + '`**!'
        )
        .addFields({ name: '🎟️ Ticket do Evento', value: '**' + formatarMoedas(TICKET_PRICE) + ' moedas**', inline: true })
        .setFooter({ text: 'Distribuição realizada' });

      const msgEvento = await canal.send({ content: '@everyone', embeds: [embed] });
      setTimeout(() => msgEvento.delete().catch(() => {}), 60000);

    } catch (error) { console.error('Erro no evento de moedas:', error.message); }
  }, EVENTO_INTERVALO_MS);
}

// ─────────────────────────────────────────────────────────────
// COMANDOS
// ─────────────────────────────────────────────────────────────

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args    = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // ══════════════════════════════════════
  // ;Saldo
  // ══════════════════════════════════════
  if (command === 'saldo') {
    const userId    = message.author.id;
    const username  = message.author.username;
    const saldo     = getMoedas(userId);
    const naLista   = db.listaEvento.some(e => e.userId === userId);
    const userColor = getColorFromUsername(username);
    const faltam    = Math.max(0, TICKET_PRICE - saldo);

    try { await message.delete(); } catch {}

    const embed = new EmbedBuilder()
      .setColor(userColor)
      .setTitle('💰 Saldo de ' + (message.author.displayName || username))
      .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
      .addFields(
        { name: '💵 Moedas',           value: '**' + formatarMoedas(saldo) + '** 🪙',       inline: true },
        { name: '🎟️ Status no Evento', value: naLista ? '✅ Já na lista!' : '❌ Não inscrito', inline: true }
      );

    if (!naLista && faltam > 0) {
      embed.addFields({ name: '📈 Faltam para o Ticket', value: '**' + formatarMoedas(faltam) + '** 🪙', inline: false });
      embed.setDescription('Use `;Buy ' + formatarMoedas(TICKET_PRICE) + '` quando tiver moedas suficientes!');
    } else if (!naLista && faltam === 0) {
      embed.setDescription('✨ Você já tem moedas suficientes! Use `;Buy ' + formatarMoedas(TICKET_PRICE) + '` para entrar!');
    } else {
      embed.setDescription('Você já faz parte do evento! Boa sorte! 🎉');
    }

    embed.setFooter({ text: 'Ticket do evento: ' + formatarMoedas(TICKET_PRICE) + ' moedas' }).setTimestamp();
    const msg = await message.channel.send({ embeds: [embed] });
    setTimeout(() => msg.delete().catch(() => {}), 15000);
    return;
  }

  // ══════════════════════════════════════
  // ;Buy <valor>
  // ══════════════════════════════════════
  if (command === 'buy') {
    const userId   = message.author.id;
    const username = message.author.displayName || message.author.username;
    const valorRaw = args[0] ? args[0].replace(/[.,]/g, '') : null;
    const valor    = parseInt(valorRaw);

    try { await message.delete(); } catch {}

    if (!valorRaw || isNaN(valor)) {
      const m = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Uso incorreto').setDescription('Use: `;Buy ' + formatarMoedas(TICKET_PRICE) + '`')]});
      setTimeout(() => m.delete().catch(() => {}), 6000); return;
    }

    if (valor !== TICKET_PRICE) {
      const m = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Valor incorreto').setDescription('O preço do ticket é **' + formatarMoedas(TICKET_PRICE) + ' moedas**.\nUse: `;Buy ' + formatarMoedas(TICKET_PRICE) + '`')]});
      setTimeout(() => m.delete().catch(() => {}), 6000); return;
    }

    if (db.listaEvento.some(e => e.userId === userId)) {
      const m = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0xE67E22).setTitle('⚠️ Já inscrito!').setDescription('Você já está na lista do evento!')]});
      setTimeout(() => m.delete().catch(() => {}), 6000); return;
    }

    const saldo = getMoedas(userId);
    if (saldo < TICKET_PRICE) {
      const faltam = TICKET_PRICE - saldo;
      const m = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Saldo Insuficiente').setDescription('Você tem **' + formatarMoedas(saldo) + ' moedas** mas precisa de **' + formatarMoedas(TICKET_PRICE) + '**.\nFaltam **' + formatarMoedas(faltam) + ' moedas** — aguarde as próximas distribuições!')]});
      setTimeout(() => m.delete().catch(() => {}), 8000); return;
    }

    setMoedas(userId, saldo - TICKET_PRICE);
    db.listaEvento.push({ userId, username, tag: message.author.tag, compradoEm: new Date().toISOString() });
    salvarDados(db);

    const posicao = db.listaEvento.length;
    await message.channel.send({ embeds: [
      new EmbedBuilder().setColor(0x2ECC71)
        .setTitle('🎉  Parabéns! Ticket Comprado!')
        .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
        .setDescription('**' + username + '** acaba de entrar para a lista do evento!\n\n🎟️ Seu ticket foi confirmado com sucesso!\n📋 Você é o participante **#' + posicao + '** da lista.')
        .setFooter({ text: 'Boa sorte no evento!' })
        .setTimestamp()
    ]});
    return;
  }

  // ══════════════════════════════════════
  // ;Lista  (apenas cargos autorizados)
  // ══════════════════════════════════════
  if (command === 'lista') {
    if (!temPermissao(message.member)) { await negarAcesso(message); return; }
    try { await message.delete(); } catch {}

    const lista = db.listaEvento;
    if (lista.length === 0) {
      const m = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0x95A5A6).setTitle('📋 Lista do Evento').setDescription('> Nenhum participante ainda.\n\nSeja o primeiro! Use `;Buy ' + formatarMoedas(TICKET_PRICE) + '` para comprar seu ticket.')]});
      setTimeout(() => m.delete().catch(() => {}), 10000); return;
    }

    const linhas = lista.slice(0, 25).map((p, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '**' + (i + 1) + '.**';
      return medal + ' <@' + p.userId + '>';
    });

    await message.channel.send({ embeds: [
      new EmbedBuilder().setColor(0xEB459E)
        .setTitle('🎟️  Lista de Participantes do Evento')
        .setDescription(linhas.join('\n'))
        .addFields({ name: '👥 Total de Participantes', value: '**' + lista.length + '**', inline: true })
        .setFooter({ text: lista.length + ' participante(s) no total' })
        .setTimestamp()
    ]});
    return;
  }

  // ══════════════════════════════════════
  // ;Zerar  (apenas cargos autorizados)
  // ══════════════════════════════════════
  if (command === 'zerar') {
    if (!temPermissao(message.member)) { await negarAcesso(message); return; }
    try { await message.delete(); } catch {}

    db.moedas = {}; db.listaEvento = []; salvarDados(db);

    const m = await message.channel.send({ embeds: [
      new EmbedBuilder().setColor(0xED4245)
        .setTitle('🗑️ Dados Zerados')
        .setDescription('✅ Tudo foi resetado com sucesso!\n\n• Moedas de todos os usuários → **0**\n• Lista do evento → **limpa**')
        .setFooter({ text: 'Zerado por ' + message.author.tag })
        .setTimestamp()
    ]});
    setTimeout(() => m.delete().catch(() => {}), 8000);
    return;
  }

  // ══════════════════════════════════════
  // ;Set @All <valor>  (apenas cargos autorizados)
  // ══════════════════════════════════════
  if (command === 'set') {
    if (!temPermissao(message.member)) { await negarAcesso(message); return; }
    try { await message.delete(); } catch {}

    const subArg   = args[0]?.toLowerCase();
    const valorRaw = args[1] ? args[1].replace(/[.,]/g, '') : null;
    const valor    = parseInt(valorRaw);

    if (subArg !== '@all' && subArg !== 'all') {
      const m = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Uso incorreto').setDescription('Use: `;Set @All <valor>`\nExemplo: `;Set @All 7000`')]});
      setTimeout(() => m.delete().catch(() => {}), 6000); return;
    }

    if (!valorRaw || isNaN(valor) || valor < 0) {
      const m = await message.channel.send({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Valor inválido').setDescription('Use: `;Set @All <valor>`\nExemplo: `;Set @All 7000`')]});
      setTimeout(() => m.delete().catch(() => {}), 6000); return;
    }

    await message.guild.members.fetch();
    const membros = message.guild.members.cache.filter(m => !m.user.bot);
    membros.forEach(membro => setMoedas(membro.user.id, valor));

    const total        = membros.size;
    const listaNomes   = membros.map(m => '• <@' + m.user.id + '>').slice(0, 40);
    const excedente    = total > 40 ? '\n*...e mais ' + (total - 40) + ' membros.*' : '';

    await message.channel.send({ embeds: [
      new EmbedBuilder().setColor(0x3498DB)
        .setTitle('💰 Moedas Distribuídas para Todos!')
        .setDescription('**' + formatarMoedas(valor) + ' moedas** foram definidas para todos os membros.\n\n**Membros que receberam:**\n' + listaNomes.join('\n') + excedente)
        .addFields(
          { name: '👥 Total de Membros', value: '**' + total + '**',                    inline: true },
          { name: '💵 Valor por Membro', value: '**' + formatarMoedas(valor) + '** 🪙', inline: true },
          { name: '👤 Executado por',    value: '<@' + message.author.id + '>',         inline: true }
        )
        .setFooter({ text: 'Moedas definidas com sucesso' })
        .setTimestamp()
    ]});
    return;
  }

  // ══════════════════════════════════════
  // ;cria  (apenas cargos autorizados)
  // Abre painel de criação de evento
  // ══════════════════════════════════════
  if (command === 'cria') {
    if (!temPermissao(message.member)) { await negarAcesso(message); return; }
    try { await message.delete(); } catch {}

    const embed = new EmbedBuilder()
      .setColor(0xEB459E)
      .setTitle('📋  Criar Novo Evento')
      .setDescription('Escolha o **tipo de evento** que deseja criar clicando em um dos botões abaixo.\nApós escolher, um formulário abrirá para preencher os detalhes.')
      .addFields({ name: '📌 Tipos disponíveis', value: Object.values(TIPOS_EVENTO).map(t => t.nome).join('\n'), inline: false })
      .setFooter({ text: 'Painel acionado por ' + message.author.tag })
      .setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('evento_torneio').setLabel('🎮 Torneio').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('evento_sorteio').setLabel('🎁 Sorteio').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('evento_competicao').setLabel('🏆 Competição').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('evento_festa').setLabel('🎉 Festa').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('evento_anuncio').setLabel('📢 Anúncio').setStyle(ButtonStyle.Primary)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('evento_guerra').setLabel('⚔️ Guerra PvP').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('evento_musical').setLabel('🎵 Musical').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('evento_especial').setLabel('🌟 Especial').setStyle(ButtonStyle.Secondary)
    );

    const painel = await message.channel.send({ embeds: [embed], components: [row1, row2] });
    setTimeout(() => painel.delete().catch(() => {}), 120000);
    return;
  }

  // ══════════════════════════════════════
  // ;registro
  // Envia embed de verificação com botão
  // ══════════════════════════════════════
  if (command === 'registro') {
    try { await message.delete(); } catch {}

    const embedRegistro = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('✅  Verificação de Membro')
      .setDescription(
        'Bem-vindo ao servidor! Para ter acesso completo aos canais, você precisa se verificar.\n\n' +
        '> Clique no botão **Verificar** abaixo para começar.\n\n' +
        '📋 Você precisará informar seu **nome no Discord** para concluir o registro.'
      )
      .addFields(
        { name: '🎁 O que você recebe', value: 'Acesso automático aos canais do servidor e os cargos de membro.', inline: false }
      )
      .setFooter({ text: 'Verificação segura • ' + message.guild.name })
      .setTimestamp();

    const botaoVerificar = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('btn_verificar')
        .setLabel('✅  Verificar')
        .setStyle(ButtonStyle.Success)
    );

    await message.channel.send({ embeds: [embedRegistro], components: [botaoVerificar] });
    return;
  }

  // ══════════════════════════════════════
  // ;Music play <url>
  // ══════════════════════════════════════
  if (command === 'music' && args[0]?.toLowerCase() === 'play') {
    const url = args[1];
    try { await message.delete(); } catch {}

    if (!url) {
      const m = await message.channel.send({ embeds: [
        new EmbedBuilder().setColor(0xED4245)
          .setTitle('❌ Link Inválido')
          .setDescription('Envie um link válido do YouTube.\nExemplo: `;Music play https://youtube.com/watch?v=...`')
      ]});
      setTimeout(() => m.delete().catch(() => {}), 6000);
      return;
    }

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
      const m = await message.channel.send({ embeds: [
        new EmbedBuilder().setColor(0xED4245)
          .setTitle('❌ Você não está em uma call!')
          .setDescription('Entre em um canal de voz para usar o `;Music play`.')
      ]});
      setTimeout(() => m.delete().catch(() => {}), 6000);
      return;
    }

    try {
      await distube.play(voiceChannel, url, {
        member: message.member,
        textChannel: message.channel,
        message
      });
    } catch (e) {
      message.channel.send('❌ Erro: ' + e.message).catch(() => {});
    }
    return;
  }

  // ══════════════════════════════════════
  // ;Music skip
  // ══════════════════════════════════════
  if (command === 'music' && args[0]?.toLowerCase() === 'skip') {
    try { await message.delete(); } catch {}

    const queue = distube.getQueue(message.guild.id);
    if (!queue) {
      const m = await message.channel.send({ embeds: [
        new EmbedBuilder().setColor(0xE67E22).setTitle('⚠️ Nenhuma música tocando!')
      ]});
      setTimeout(() => m.delete().catch(() => {}), 5000);
      return;
    }

    try {
      await distube.skip(message.guild.id);
      const m = await message.channel.send({ embeds: [
        new EmbedBuilder().setColor(0xF1C40F).setTitle('⏭️ Música Pulada')
      ]});
      setTimeout(() => m.delete().catch(() => {}), 5000);
    } catch (e) {
      message.channel.send('❌ ' + e.message).catch(() => {});
    }
    return;
  }

  // ══════════════════════════════════════
  // ;Music stop
  // ══════════════════════════════════════
  if (command === 'music' && args[0]?.toLowerCase() === 'stop') {
    try { await message.delete(); } catch {}

    const queue = distube.getQueue(message.guild.id);
    if (!queue) {
      const m = await message.channel.send({ embeds: [
        new EmbedBuilder().setColor(0xE67E22).setTitle('⚠️ Nenhuma música tocando!')
      ]});
      setTimeout(() => m.delete().catch(() => {}), 5000);
      return;
    }

    await distube.stop(message.guild.id);
    const m = await message.channel.send({ embeds: [
      new EmbedBuilder().setColor(0xED4245)
        .setTitle('⏹️ Música Parada')
        .setDescription('A música foi parada e o bot saiu do canal de voz.')
    ]});
    setTimeout(() => m.delete().catch(() => {}), 5000);
    return;
  }

  // ══════════════════════════════════════
  // ;Music fila
  // ══════════════════════════════════════
  if (command === 'music' && args[0]?.toLowerCase() === 'fila') {
    try { await message.delete(); } catch {}

    const queue = distube.getQueue(message.guild.id);
    if (!queue || queue.songs.length === 0) {
      const m = await message.channel.send({ embeds: [
        new EmbedBuilder().setColor(0x95A5A6)
          .setTitle('📋 Fila de Músicas')
          .setDescription('Nenhuma música na fila. Use `;Music play <link>` para adicionar!')
      ]});
      setTimeout(() => m.delete().catch(() => {}), 8000);
      return;
    }

    const linhas = queue.songs.map((s, i) => {
      const prefixo = i === 0 ? '▶️ **Tocando:** ' : '**' + (i + 1) + '.** ';
      return prefixo + '[' + s.name + '](' + s.url + ') — *' + (s.user?.username || '?') + '*';
    });

    const m = await message.channel.send({ embeds: [
      new EmbedBuilder().setColor(0x3498DB)
        .setTitle('📋 Fila de Músicas')
        .setDescription(linhas.join('\n\n'))
        .addFields({ name: '🎵 Total', value: '**' + queue.songs.length + '** música(s)', inline: true })
        .setTimestamp()
    ]});
    setTimeout(() => m.delete().catch(() => {}), 20000);
    return;
  }
});

// ─────────────────────────────────────────────────────────────
// INTERAÇÕES (Botões + Modais)
// ─────────────────────────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {

  // ── Autocomplete: estado ──────────────────────────────────
  if (interaction.isAutocomplete() && interaction.commandName === 'rg') {
    const digitado = interaction.options.getFocused().toLowerCase();
    const filtrado = ESTADOS_BRASIL
      .filter(e => e.toLowerCase().includes(digitado))
      .slice(0, 25)
      .map(e => ({ name: e, value: e }));
    await interaction.respond(filtrado);
    return;
  }

  // ── Slash Command: /rg ───────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'rg') {
    const nomeSobrenome   = interaction.options.getString('nome_sobrenome');
    const dataNascimento  = interaction.options.getString('data_nascimento');
    const naturalidade    = interaction.options.getString('naturalidade');
    const sexo            = interaction.options.getString('sexo');
    const foto            = interaction.options.getAttachment('foto_3x4');
    const estado          = interaction.options.getString('estado');

    // Valida se o anexo enviado é realmente uma imagem
    if (!foto.contentType || !foto.contentType.startsWith('image/')) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle('❌ Arquivo Inválido')
            .setDescription('O arquivo enviado em **foto_3x4** precisa ser uma imagem (PNG, JPG, etc).')
        ],
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const erros = [];

    // ── 1. Muda o nickname ────────────────────────────────
    try {
      await interaction.member.setNickname(nomeSobrenome);
    } catch (e) {
      erros.push('Não foi possível mudar o nickname (permissão necessária).');
      console.error('Erro ao mudar nickname:', e.message);
    }

    // ── 2. Função auxiliar: cria cargo estilizado ─────────
    async function darCargoEstilizado(nomeCargo, cor) {
      const nomeFormatado = '[ ' + nomeCargo + ' ]';
      try {
        let cargo = interaction.guild.roles.cache.find(
          r => r.name === nomeFormatado
        );
        if (!cargo) {
          cargo = await interaction.guild.roles.create({
            name: nomeFormatado,
            color: cor,
            hoist: true,
            reason: 'Cargo criado automaticamente via /rg'
          });
        }
        await interaction.member.roles.add(cargo);
        return nomeFormatado;
      } catch (e) {
        console.error('Erro ao criar/dar cargo "' + nomeFormatado + '":', e.message);
        erros.push('Cargo **' + nomeFormatado + '** não pôde ser atribuído.');
        return null;
      }
    }

    // ── 3. Dar cargos estilizados ─────────────────────────
    const cargoEstado       = await darCargoEstilizado(estado,       0x9B59B6); // Roxo
    const cargoNaturalidade = await darCargoEstilizado(naturalidade, 0xE67E22); // Laranja
    const cargoSexo         = await darCargoEstilizado(sexo,         0x2ECC71); // Verde

    // ── 4. Dar os dois cargos de verificação ─────────────
    try {
      await interaction.member.roles.add(VERIFICACAO_CARGO_ID_1);
      await interaction.member.roles.add(VERIFICACAO_CARGO_ID_2);
    } catch (e) {
      erros.push('Cargos de verificação não puderam ser atribuídos.');
      console.error('Erro ao dar cargos de verificação:', e.message);
    }

    // ── 5. Envia a ficha no canal de fichas ───────────────
    const embedFicha = new EmbedBuilder()
      .setColor(0x3498DB)
      .setTitle('📋  Nova Ficha de Personagem')
      .setThumbnail(foto.url)
      .addFields(
        { name: '👤 Nome e Sobrenome',   value: nomeSobrenome,  inline: false },
        { name: '🎂 Data de Nascimento', value: dataNascimento, inline: true  },
        { name: '📍 Naturalidade',       value: naturalidade,   inline: true  },
        { name: '⚧️ Sexo',               value: sexo,           inline: true  },
        { name: '🗺️ Estado',             value: estado,         inline: true  }
      )
      .setFooter({ text: 'Ficha criada por ' + interaction.user.tag })
      .setTimestamp();

    try {
      const canalFichas = await client.channels.fetch(PERSONAGEM_CHANNEL_ID).catch(() => null);
      if (canalFichas) await canalFichas.send({ embeds: [embedFicha] });
    } catch (e) {
      console.error('Erro ao enviar ficha:', e.message);
    }

    // ── 6. Confirmação privada ────────────────────────────
    const cargosAtribuidos = [cargoEstado, cargoNaturalidade, cargoSexo]
      .filter(Boolean).map(c => '**' + c + '**').join(', ');

    const descricao = [
      '✅ Nickname alterado para **' + nomeSobrenome + '**',
      '🎭 Cargos atribuídos: ' + (cargosAtribuidos || 'nenhum'),
      erros.length > 0 ? '\n⚠️ Avisos:\n' + erros.join('\n') : ''
    ].filter(Boolean).join('\n');

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(erros.length > 0 ? 0xE67E22 : 0x57F287)
          .setTitle('✅ RG Criado com Sucesso!')
          .setDescription(descricao)
      ]
    });
    return;
  }

  // ── Botão: Verificar ─────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'btn_verificar') {

    // Verifica se já tem os cargos (já verificado)
    const jaTemCargo1 = interaction.member.roles.cache.has(VERIFICACAO_CARGO_ID_1);
    const jaTemCargo2 = interaction.member.roles.cache.has(VERIFICACAO_CARGO_ID_2);

    if (jaTemCargo1 && jaTemCargo2) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xE67E22)
            .setTitle('⚠️ Já Verificado')
            .setDescription('Você já está verificado e possui os cargos de membro!\nAproveite o servidor. 🎉')
        ],
        ephemeral: true
      });
    }

    // Abre modal pedindo o nome
    const modalRegistro = new ModalBuilder()
      .setCustomId('modal_registro')
      .setTitle('📋 Registro de Membro');

    modalRegistro.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('campo_nome_discord')
          .setLabel('Qual é o seu nome no Discord?')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: SeuNome#0000 ou seuapelido')
          .setMinLength(2)
          .setMaxLength(50)
          .setRequired(true)
      )
    );

    await interaction.showModal(modalRegistro);
  }

  // ── Modal: Concluir registro e dar cargos ────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'modal_registro') {
    const nomeInformado = interaction.fields.getTextInputValue('campo_nome_discord').trim();
    const member        = interaction.member;
    const erros         = [];

    // Tenta dar o cargo 1
    try {
      await member.roles.add(VERIFICACAO_CARGO_ID_1);
    } catch (e) {
      erros.push('Cargo 1');
      console.error('Erro ao dar cargo 1:', e.message);
    }

    // Tenta dar o cargo 2
    try {
      await member.roles.add(VERIFICACAO_CARGO_ID_2);
    } catch (e) {
      erros.push('Cargo 2');
      console.error('Erro ao dar cargo 2:', e.message);
    }

    if (erros.length > 0) {
      // Avisa se deu erro (geralmente permissão do bot)
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle('❌ Erro na Verificação')
            .setDescription(
              'Ocorreu um erro ao atribuir seus cargos (**' + erros.join(', ') + '**).\n\n' +
              '> Por favor, contate um administrador do servidor para regularizar seu acesso.'
            )
        ],
        ephemeral: true
      });
    }

    // Sucesso — mensagem privada só para o usuário (ephemeral)
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('🎉  Verificação Concluída!')
          .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
          .setDescription(
            '**' + (interaction.member.displayName || interaction.user.username) + '** acaba de ser verificado!\n\n' +
            '✅ Seus cargos foram atribuídos com sucesso.\n' +
            '📛 Nome informado: **' + nomeInformado + '**\n\n' +
            'Bem-vindo ao servidor! Aproveite todos os canais. 🎊'
          )
          .setFooter({ text: 'Registro concluído em ' + interaction.guild.name })
          .setTimestamp()
      ],
      ephemeral: true
    });

    // ── Envia log de verificação ──────────────────────────
    try {
      const canalLog = await client.channels.fetch(VERIFICACAO_LOG_CHANNEL_ID).catch(() => null);
      if (canalLog) {
        const embedLog = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('📋  Novo Membro Verificado')
          .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
          .addFields(
            { name: '👤 Usuário',        value: interaction.user.tag,          inline: false },
            { name: '📛 Nome Informado', value: '**' + nomeInformado + '**',   inline: false },
            { name: '📅 Data/Hora',      value: '<t:' + Math.floor(Date.now() / 1000) + ':F>', inline: false }
          )
          .setFooter({ text: 'Log de Verificação • ' + interaction.guild.name })
          .setTimestamp();

        await canalLog.send({ embeds: [embedLog] });
      }
    } catch (e) {
      console.error('Erro ao enviar log de verificação:', e.message);
    }
  }

  // ── Botão: abrir modal do tipo de evento ─────────────────
  if (interaction.isButton() && TIPOS_EVENTO[interaction.customId]) {
    const tipoId   = interaction.customId;
    const tipoNome = TIPOS_EVENTO[tipoId].nome;

    const modal = new ModalBuilder()
      .setCustomId('modal_evento_' + tipoId)
      .setTitle('Criar Evento: ' + tipoNome);

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('campo_nome').setLabel('Nome do Evento')
          .setStyle(TextInputStyle.Short).setPlaceholder('Ex: Grande Torneio de Verão')
          .setMinLength(3).setMaxLength(100).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('campo_data').setLabel('Data do Evento')
          .setStyle(TextInputStyle.Short).setPlaceholder('Ex: 25/12/2025')
          .setMinLength(5).setMaxLength(20).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('campo_horario').setLabel('Horário do Evento')
          .setStyle(TextInputStyle.Short).setPlaceholder('Ex: 20:00 (Horário de Brasília)')
          .setMinLength(3).setMaxLength(50).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('campo_regras').setLabel('Regras do Evento')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(REGRAS_PADRAO[tipoId] || '1. Respeite todos os participantes\n2. Siga as orientações do staff')
          .setMinLength(5).setMaxLength(1000).setRequired(true)
      )
    );

    await interaction.showModal(modal);
  }

  // ── Modal: publicar evento ────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_evento_')) {
    const tipoId   = interaction.customId.replace('modal_evento_', '');
    const tipo     = TIPOS_EVENTO[tipoId] || { nome: '🌟 Evento Especial', cor: 0xEB459E };

    const nome    = interaction.fields.getTextInputValue('campo_nome').trim();
    const data    = interaction.fields.getTextInputValue('campo_data').trim();
    const horario = interaction.fields.getTextInputValue('campo_horario').trim();
    const regras  = interaction.fields.getTextInputValue('campo_regras').trim();

    const embed = new EmbedBuilder()
      .setColor(tipo.cor)
      .setTitle(tipo.nome + '  •  ' + nome)
      .setDescription('@everyone\n\n📣 Um novo evento foi criado! Confira os detalhes abaixo e não perca!')
      .addFields(
        { name: '📅 Data',    value: '**' + data + '**',    inline: true },
        { name: '🕐 Horário', value: '**' + horario + '**', inline: true },
        { name: '📋 Tipo',    value: tipo.nome,              inline: true },
        { name: '📜 Regras',  value: regras,                 inline: false }
      )
      .setFooter({ text: 'Evento criado por ' + interaction.user.tag })
      .setTimestamp();

    await interaction.message.delete().catch(() => {});
    await interaction.channel.send({ content: '@everyone', embeds: [embed] });
    await interaction.reply({ content: '✅ Evento publicado com sucesso!', ephemeral: true });
  }
});

// ─────────────────────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────────────────────

const TOKEN = 'MTQ5NzM0MTEyNzAzMDczNTA2MA.GBzyDi.6Fl-O8uh_ML6M0VunYMwLYYw-8hP8ELB6D53zc'; // ⚠️ Coloque seu token do Discord aqui

if (TOKEN === 'SEU_TOKEN_AQUI') {
  console.error('❌ ERRO: Insira o token do seu bot em TOKEN antes de iniciar!');
  process.exit(1);
}

client.login(TOKEN);
