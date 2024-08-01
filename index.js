const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { token, guildID, adminIDs } = require('./config.json');

const Database = require('easy-json-database');
const db = new Database('./db.json');
if (!db.has('subscriptions')) db.set('subscriptions', []);

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const synchronizeSlashCommands = async (client) => {
    const commands = [
        {
            name: 'abonner',
            description: 'Abonnez-vous à une URL de recherche',
            options: [
                {
                    name: 'url',
                    description: 'L\'URL de la recherche Vinted',
                    type: 3, // STRING
                    required: true
                },
                {
                    name: 'channel',
                    description: 'Le salon dans lequel vous souhaitez envoyer les notifications',
                    type: 7, // CHANNEL
                    required: true
                }
            ]
        },
        {
            name: 'désabonner',
            description: 'Désabonnez-vous d\'une URL de recherche',
            options: [
                {
                    name: 'id',
                    description: 'L\'identifiant de l\'abonnement (/abonnements)',
                    type: 3, // STRING
                    required: true
                }
            ]
        },
        {
            name: 'abonnements',
            description: 'Accédez à la liste de tous vos abonnements',
            options: []
        }
    ];

    const rest = new REST({ version: '10' }).setToken(token);

    try {
        const result = await rest.put(
            Routes.applicationGuildCommands(client.user.id, guildID),
            { body: commands }
        );

        console.log(`🔁 Commandes mises à jour ! ${result.length} commandes créées\n`);
    } catch (error) {
        console.error(error);
    }
};

const vinted = require('vinted-api');

let lastFetchFinished = true;

const syncSubscription = (sub) => {
    return new Promise((resolve) => {
        vinted.search(sub.url, false, false, {
            per_page: '20'
        }).then((res) => {
            if (!res.items) {
                console.log('Search done but got wrong response. Promise resolved.', res);
                resolve();
                return;
            }
            const isFirstSync = db.get('is_first_sync');
            const lastItemTimestamp = db.get(`last_item_ts_${sub.id}`);
            const items = res.items
                .sort((a, b) => new Date(b.created_at_ts).getTime() - new Date(a.created_at_ts).getTime())
                .filter((item) => !lastItemTimestamp || new Date(item.created_at_ts) > lastItemTimestamp);

            if (!items.length) return void resolve();

            const newLastItemTimestamp = new Date(items[0].created_at_ts).getTime();
            if (!lastItemTimestamp || newLastItemTimestamp > lastItemTimestamp) {
                db.set(`last_item_ts_${sub.id}`, newLastItemTimestamp);
            }

            const itemsToSend = ((lastItemTimestamp && !isFirstSync) ? items.reverse() : [items[0]]);

            for (let item of itemsToSend) {
                const embed = new EmbedBuilder()
                    .setTitle(item.title)
                    .setURL(`https://www.vinted.fr${item.path}`)
                    .setImage(item.photos[0]?.url)
                    .setColor('#008000')
                    .setTimestamp(item.createdTimestamp)
                    .setFooter({ text: `Article lié à la recherche : ${sub.id}` })
                    .addFields(
                        { name: 'Taille', value: item.size || 'vide', inline: true },
                        { name: 'Prix', value: item.price || 'vide', inline: true },
                        { name: 'Condition', value: item.status || 'vide', inline: true }
                    );

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setLabel('Détails')
                            .setURL(item.url)
                            .setEmoji('🔎')
                            .setStyle(ButtonStyle.Link),
                        new ButtonBuilder()
                            .setLabel('Acheter')
                            .setURL(`https://www.vinted.fr/transaction/buy/new?source_screen=item&transaction%5Bitem_id%5D=${item.id}`)
                            .setEmoji('💸')
                            .setStyle(ButtonStyle.Link)
                    );

                client.channels.cache.get(sub.channelID)?.send({ embeds: [embed], components: [row] });
            }

            if (itemsToSend.length > 0) {
                console.log(`👕 ${itemsToSend.length} ${itemsToSend.length > 1 ? 'nouveaux articles trouvés' : 'nouvel article trouvé'} pour la recherche ${sub.id} !\n`)
            }

            resolve();
        }).catch((e) => {
            console.error('Search returned an error. Promise resolved.', e);
            resolve();
        });
    });
};

const sync = () => {
    if (!lastFetchFinished) return;
    lastFetchFinished = false;

    console.log(`🤖 Synchronisation à Vinted...\n`);

    const subscriptions = db.get('subscriptions');
    const promises = subscriptions.map((sub) => syncSubscription(sub));
    Promise.all(promises).then(() => {
        db.set('is_first_sync', false);
        lastFetchFinished = true;
    });
};

client.once('ready', () => {
    console.log(`🔗 Connecté sur le compte de ${client.user.tag} !\n`);

    const entries = db.all().filter((e) => e.key !== 'subscriptions' && !e.key.startsWith('last_item_ts'));
    entries.forEach((e) => {
        db.delete(e.key);
    });
    db.set('is_first_sync', true);

    const messages = [
        `🤖 Vinted BOT est en ligne !`,
    ];
    let idx = 0;
    const donate = () => console.log(messages[idx % 2]);
    setTimeout(() => {
        donate();
    }, 3000);
    setInterval(() => {
        idx++;
        donate();
    }, 20000);

    sync();
    setInterval(sync, 10000);

    const { version } = require('./package.json');
    client.user.setActivity(`Vinted BOT | v${version}`);

    synchronizeSlashCommands(client);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;
    if (!adminIDs.includes(interaction.user.id)) {
        return interaction.reply(`:x: Vous ne disposez pas des droits pour effectuer cette action !`);
    }

    switch (interaction.commandName) {
        case 'abonner': {
            const sub = {
                id: Math.random().toString(36).substring(7),
                url: interaction.options.getString('url'),
                channelID: interaction.options.getChannel('channel').id
            };
            db.push('subscriptions', sub);
            db.set(`last_item_ts_${sub.id}`, null);
            await interaction.reply(`:white_check_mark: Votre abonnement a été créé avec succès !\n**URL**: <${sub.url}>\n**Salon**: <#${sub.channelID}>`);
            break;
        }
        case 'désabonner': {
            const subID = interaction.options.getString('id');
            const subscriptions = db.get('subscriptions');
            const subscription = subscriptions.find((sub) => sub.id === subID);
            if (!subscription) {
                return await interaction.reply(':x: Aucun abonnement trouvé pour votre recherche...');
            }
            const newSubscriptions = subscriptions.filter((sub) => sub.id !== subID);
            db.set('subscriptions', newSubscriptions);
            await interaction.reply(`:white_check_mark: Abonnement supprimé avec succès !\n**URL**: <${subscription.url}>\n**Salon**: <#${subscription.channelID}>`);
            break;
        }
        case 'abonnements': {
            const subscriptions = db.get('subscriptions');
            const chunks = [];

            subscriptions.forEach((sub) => {
                const content = `**ID**: ${sub.id}\n**URL**: ${sub.url}\n**Salon**: <#${sub.channelID}>\n`;
                const lastChunk = chunks.shift() || [];
                if ((lastChunk.join('\n').length + content.length) > 1024) {
                    if (lastChunk) chunks.push(lastChunk);
                    chunks.push([content]);
                } else {
                    lastChunk.push(content);
                    chunks.push(lastChunk);
                }
            });

            await interaction.reply(`:white_check_mark: **${subscriptions.length}** abonnements sont actifs !`);

            chunks.forEach((chunk) => {
                const embed = new EmbedBuilder()
                    .setColor('RED')
                    .setAuthor({ name: 'Utilisez la commande /désabonner pour supprimer un abonnement !' })
                    .setDescription(chunk.join('\n'));

                interaction.channel.send({ embeds: [embed] });
            });
            break;
        }
    }
});

client.login(token);
