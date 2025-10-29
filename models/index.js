const { Sequelize } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, '..', 'database.sqlite'),
    logging: false
});

const models = {
    Account: require('./Account')(sequelize),
    Contact: require('./Contact')(sequelize),
    MessageTemplate: require('./MessageTemplate')(sequelize),
    Campaign: require('./Campaign')(sequelize),
    CampaignMessage: require('./CampaignMessage')(sequelize),
    MediaFile: require('./MediaFile')(sequelize),
    ActivityLog: require('./ActivityLog')(sequelize)
};

Object.keys(models).forEach(modelName => {
    if (models[modelName].associate) {
        models[modelName].associate(models);
    }
});

models.sequelize = sequelize;
models.Sequelize = Sequelize;

module.exports = models;
