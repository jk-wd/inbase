const { helper } = require('./lib/helper.mjs')
const config = require('./config.json')

class Server {
  start() {
    return helper() + config.name
  }
}

module.exports = { Server }
