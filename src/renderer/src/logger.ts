import log from 'electron-log/renderer'

log.errorHandler.startCatching({ showDialog: false })
Object.assign(console, log.functions)

export default log
