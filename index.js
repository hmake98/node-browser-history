const path = require("path"),
  fs = require("fs"),
  sqlite3 = require("sqlite3").verbose(),
  uuidV4 = require("uuid/v4"),
  moment = require("moment")

let browserHistoryDllPath = "",
  getInternetExplorerHistory = null,
  browsers = require("./browsers")

if (process.platform === "win32") {

  if (fs.existsSync(
      path.resolve(path.join(__dirname, "..", "..", "src", "renderer", "assets", "dlls", "IEHistoryFetcher.dll")))) {
    browserHistoryDllPath = path.join(
      __dirname, "..", "..", "src", "renderer", "assets", "dlls", "IEHistoryFetcher.dll")
  } else if (fs.existsSync(
      path.join(__dirname, "..", "..", "..", "src", "renderer", "assets", "dlls", "IEHistoryFetcher.dll"))) {
    browserHistoryDllPath = path.join(
      __dirname, "..", "..", "..", "src", "renderer", "assets", "dlls", "IEHistoryFetcher.dll")
  } else {
    browserHistoryDllPath = path.resolve(path.join(__dirname, "dlls", "IEHistoryFetcher.dll"))
  }

}

/**
 * Runs the the proper function for the given browser. Some browsers follow the same standards as
 * chrome and firefox others have their own syntax.
 * Returns an empty array or an array of browser record objects
 * @param paths
 * @param browserName
 * @param historyTimeLength
 * @returns {Promise<array>}
 */
async function getBrowserHistory(paths = [], browserName, historyTimeLength) {
  switch (browserName) {
    case browsers.FIREFOX:
    case browsers.SEAMONKEY:
      return await getMozillaBasedBrowserRecords(paths, browserName, historyTimeLength)

    case browsers.CHROME:
    case browsers.OPERA:
    case browsers.TORCH:
    case browsers.VIVALDI:
      return await getChromeBasedBrowserRecords(paths, browserName, historyTimeLength)
    case browsers.MAXTHON:
      return await getMaxthonBasedBrowserRecords(paths, browserName, historyTimeLength)

    case browsers.SAFARI:
      return await getSafariBasedBrowserRecords(paths, browserName, historyTimeLength)

    case browsers.INTERNETEXPLORER:
      //Only do this on Windows we have to do t his here because the DLL manages this
      if (process.platform !== "win32") {
        return []
      }
      return await getInternetExplorerBasedBrowserRecords(historyTimeLength)

    default:
      return []
  }
}

function getInternetExplorerBasedBrowserRecords(historyTimeLength) {
  let internetExplorerHistory = []
  return new Promise((resolve, reject) => {
    getInternetExplorerHistory(null, (error, s) => {
      if (error) {
        throw (error)
      } else {
        let currentTime = moment.utc()
        let fiveMinutesAgo = currentTime.subtract(historyTimeLength, "minutes")
        s.forEach(record => {
          let lastVisited = moment.utc(record.LastVisited)
          if (lastVisited > fiveMinutesAgo) {
            if (!record.URL.startsWith("file:///")) {
              internetExplorerHistory.push({
                title: record.Title,
                utc_time: lastVisited.valueOf(),
                url: record.URL,
                browser: browsers.INTERNETEXPLORER
              })
            }
          }
        })
        resolve(internetExplorerHistory)
      }
    })
  })
}

async function getChromeBasedBrowserRecords(paths, browserName, historyTimeLength) {
  if (!paths || paths.length === 0) {
    return new Promise((res, rej) => res([]));
  }

  let promisesArr = [];

  for (let p in paths) {
    promisesArr.push(
      new Promise((resolve, reject) => {
        let browserHistory = []
        if (paths.hasOwnProperty(p) && paths[p] !== "") {
          let newDbPath = path.join(process.env.TMP ? process.env.TMP : process.env.TMPDIR, uuidV4() + ".sqlite")
          //Assuming the sqlite file is locked so lets make a copy of it
          let readStream = fs.createReadStream(paths[p])
          let writeStream = fs.createWriteStream(newDbPath)
          let stream = readStream.pipe(writeStream)

          stream.on("finish", () => {
            let db = new sqlite3.Database(newDbPath)
            db.serialize(() => {
              db.each(
                "SELECT title, last_visit_time, url from urls WHERE DATETIME (last_visit_time/1000000 + (strftime('%s', '1601-01-01')), 'unixepoch')  >= DATETIME('now', '-" +
                historyTimeLength + " minutes')",
                function (err, row) {
                  if (err) {
                    return reject(err)
                  } else {
                    let t = moment.unix(row.last_visit_time / 1000000 - 11644473600)
                    browserHistory.push({
                      title: row.title,
                      utc_time: t.valueOf(),
                      url: row.url,
                      browser: browserName
                    })
                  }
                })
              db.close(() => {
                fs.unlink(newDbPath, (err) => {
                  if (err) {
                    return reject(err)
                  }
                })
                console.log('resolving browser history', browserHistory.length);
                return resolve(browserHistory)
              })
            })
          })
        }
      })
    )
  }
  return await Promise.all(promisesArr)
}

async function getMozillaBasedBrowserRecords(paths, browserName, historyTimeLength) {
  console.log(paths, browserName, historyTimeLength)
  if (!paths || paths.length === 0) {
    return new Promise((res, rej) => res([]));
  }

  let promisesArr = [];

  for (let i = 0; i < paths.length; i++) {
    promisesArr.push(
      new Promise((resolve, reject) => {
        let browserHistory = []
        if (paths[i] || paths[i] !== "") {
          let newDbPath = path.join(process.env.TMP ? process.env.TMP : process.env.TMPDIR, uuidV4() + ".sqlite")
          const originalDB = new sqlite3.Database(paths[i])
          originalDB.serialize(() => {
            originalDB.run("PRAGMA wal_checkpoint(FULL)")
            originalDB.close(() => {
              let readStream = fs.createReadStream(paths[i]),
                writeStream = fs.createWriteStream(newDbPath),
                stream = readStream.pipe(writeStream)

              stream.on("finish", () => {
                let db = new sqlite3.Database(newDbPath)
                db.serialize(function () {
                  db.each(
                    "SELECT title, last_visit_date, url from moz_places WHERE DATETIME (last_visit_date/1000000, 'unixepoch')  >= DATETIME('now', '-" +
                    historyTimeLength + " minutes')",
                    function (err, row) {
                      if (err) {
                        reject(err)
                        console.log(err)
                      } else {
                        let t = moment.unix(row.last_visit_date / 1000000)
                        browserHistory.push({
                          title: row.title,
                          utc_time: t.valueOf(),
                          url: row.url,
                          browser: browserName
                        })
                      }
                    })
                  db.close(() => {
                    fs.unlink(newDbPath, (err) => {
                      if (err) {
                        return reject(err)
                      }
                    })
                    console.log('resolving browser history', browserHistory.length, browserName);
                    resolve(browserHistory)
                  })
                })
              })
            })
          })
        }
      })
    )
  }
  return await Promise.all(promisesArr)

}

function getMaxthonBasedBrowserRecords(paths, browserName, historyTimeLength) {
  let browserHistory = [],
    h = []
  return new Promise((resolve, reject) => {
    if (!paths || paths.length === 0) {
      resolve(browserHistory)
    }
    for (let i = 0; i < paths.length; i++) {
      if (paths[i] || paths[i] !== "") {

        let newDbPath = path.join(process.env.TMP ? process.env.TMP : process.env.TMPDIR, uuidV4() + ".db")

        //Assuming the sqlite file is locked so lets make a copy of it
        const originalDB = new sqlite3.Database(paths[i])
        originalDB.serialize(() => {
          // This has to be called to merge .db-wall, the in memory db, to disk so we can access the history when
          // safari is open
          originalDB.run("PRAGMA wal_checkpoint(FULL)")
          originalDB.close(() => {
            let readStream = fs.createReadStream(paths[i]),
              writeStream = fs.createWriteStream(newDbPath),
              stream = readStream.pipe(writeStream)

            stream.on("finish", function () {
              const db = new sqlite3.Database(newDbPath)
              db.serialize(() => {
                db.run("PRAGMA wal_checkpoint(FULL)")
                db.each(
                  "SELECT `zlastvisittime`, `zhost`, `ztitle`, `zurl` FROM   zmxhistoryentry WHERE  Datetime (`zlastvisittime` + 978307200, 'unixepoch') >= Datetime('now', '-" +
                  historyTimeLength + " minutes')",
                  function (err, row) {
                    if (err) {
                      reject(err)
                    } else {
                      let t = moment.unix(Math.floor(row.ZLASTVISITTIME + 978307200))
                      browserHistory.push({
                        title: row.ZTITLE,
                        utc_time: t.valueOf(),
                        url: row.ZURL,
                        browser: browserName
                      })
                    }
                  })

                db.close(() => {
                  fs.unlink(newDbPath, (err) => {
                    if (err) {
                      return reject(err)
                    }
                  })
                  resolve(browserHistory)
                })
              })
            })
          })

        })
      }
    }
  })
}

async function getSafariBasedBrowserRecords(paths, browserName, historyTimeLength) {
  console.log(paths)
  if (!paths || paths.length === 0) {
    return new Promise((res, rej) => res([]));
  }
  let promisesArr = [];
  for (let i = 0; i < paths.length; i++) {
    promisesArr.push(
      new Promise((resolve, reject) => {
        let browserHistory = []
        if (paths[i] || paths[i] !== "") {
          let newDbPath = path.join(process.env.TMP ? process.env.TMP : process.env.TMPDIR, uuidV4() + ".db")
          const originalDB = new sqlite3.Database(paths[i])
          originalDB.serialize(() => {
            originalDB.run("PRAGMA wal_checkpoint(FULL)")
            originalDB.close(() => {
              let readStream = fs.createReadStream(paths[i]),
                writeStream = fs.createWriteStream(newDbPath),
                stream = readStream.pipe(writeStream)

              stream.on("finish", () => {
                const db = new sqlite3.Database(newDbPath)
                db.serialize(() => {
                  db.run("PRAGMA wal_checkpoint(FULL)")
                  db.each(
                    "SELECT i.id, i.url, v.title, v.visit_time FROM history_items i INNER JOIN history_visits v on i.id = v.history_item WHERE DATETIME (v.visit_time + 978307200, 'unixepoch')  >= DATETIME('now', '-" +
                    historyTimeLength + " minutes')",
                    function (err, row) {
                      if (err) {
                        reject(err)
                      } else {
                        let t = moment.unix(Math.floor(row.visit_time + 978307200))
                        browserHistory.push({
                          title: row.title,
                          utc_time: t.valueOf(),
                          url: row.url,
                          browser: browserName
                        })
                      }
                    })
                  db.close(() => {
                    fs.unlink(newDbPath, (err) => {
                      if (err) {
                        return reject(err)
                      }
                    })
                    console.log('resolving browser history', browserHistory.length);
                    return resolve(browserHistory)
                  })
                })
              })
            })
          })
        }
      })
    )
  }
  return await Promise.all(promisesArr)
}

/**
 * Gets Firefox history
 * @param historyTimeLength time is in minutes
 * @returns {Promise<array>}
 */
function getFirefoxHistory(historyTimeLength = 5) {
  return new Promise((res, rej) => {
    browsers.browserDbLocations.firefox = browsers.findPaths(browsers.defaultPaths.firefox, browsers.FIREFOX)
    getBrowserHistory(browsers.browserDbLocations.firefox, browsers.FIREFOX, historyTimeLength).then(data => {
      console.log(data)
      let d = [];
      data.forEach(dataNew => {
        d = [...d, ...dataNew]
      });
      res(d);
    });
  })
}

/**
 * Gets Seamonkey History
 * @param historyTimeLength time is in minutes
 * @returns {Promise<array>}
 */
function getSeaMonkeyHistory(historyTimeLength = 5) {
  let getPaths = [
    browsers.findPaths(browsers.defaultPaths.seamonkey, browsers.SEAMONKEY).then(foundPaths => {
      browsers.browserDbLocations.seamonkey = foundPaths
    })
  ]
  Promise.all(getPaths).then(() => {
    let getRecords = [
      getBrowserHistory(browsers.browserDbLocations.seamonkey, browsers.SEAMONKEY, historyTimeLength)
    ]
    Promise.all(getRecords).then((records) => {
      return records
    }, error => {
      throw error
    })
  }, error => {
    throw error
  })
}

/**
 * Gets Chrome History
 * @param historyTimeLength time is in minutes
 * @returns {Promise<array>}
 */
async function getChromeHistory(historyTimeLength = 5) {
  return new Promise((res, rej) => {
    browsers.browserDbLocations.chrome = browsers.findPaths(browsers.defaultPaths.chrome, browsers.CHROME)
    getBrowserHistory(browsers.browserDbLocations.chrome, browsers.CHROME, historyTimeLength).then(data => {
      let d = [];
      data.forEach(dataNew => {
        d = [...d, ...dataNew]
      });
      res(d);
    });
  })
}

/**
 * Get Opera History
 * @param historyTimeLength time is in minutes
 * @returns {Promise<array>}
 */
async function getOperaHistory(historyTimeLength = 5) {
  let getPaths = [
    browsers.findPaths(browsers.defaultPaths.opera, browsers.OPERA).then(foundPaths => {
      browsers.browserDbLocations.opera = foundPaths
    })
  ]
  Promise.all(getPaths).then(() => {
    let getRecords = [
      getBrowserHistory(browsers.browserDbLocations.opera, browsers.OPERA, historyTimeLength)
    ]
    Promise.all(getRecords).then((records) => {
      return records
    }, error => {
      throw error
    })
  }, error => {
    throw error
  })
}

/**
 * Get Torch History
 * @param historyTimeLength time is in minutes
 * @returns {Promise<array>}
 */
async function getTorchHistory(historyTimeLength = 5) {
  let getPaths = [
    browsers.findPaths(browsers.defaultPaths.torch, browsers.TORCH).then(foundPaths => {
      browsers.browserDbLocations.torch = foundPaths
    })
  ]
  Promise.all(getPaths).then(() => {
    let getRecords = [
      getBrowserHistory(browsers.browserDbLocations.torch, browsers.TORCH, historyTimeLength)
    ]
    Promise.all(getRecords).then((records) => {
      return records
    }, error => {
      throw error
    })
  }, error => {
    throw error
  })
}

/**
 * Get Safari History
 * @param historyTimeLength time is in minutes
 * @returns {Promise<array>}
 */
async function getSafariHistory(historyTimeLength = 5) {
  return new Promise((res, rej) => {
    browsers.browserDbLocations.safari = browsers.findPaths(browsers.defaultPaths.safari, browsers.SAFARI)
    getBrowserHistory(browsers.browserDbLocations.safari, browsers.SAFARI, historyTimeLength).then(data => {
      let d = [];
      data.forEach(dataNew => {
        d = [...d, ...dataNew]
      });
      res(d);
    });
  })
}

/**
 * Get Maxthon History
 * @param historyTimeLength time is in minutes
 * @returns {Promise<array>}
 */
async function getMaxthonHistory(historyTimeLength = 5) {
  let getPaths = [
    browsers.findPaths(browsers.defaultPaths.maxthon, browsers.MAXTHON).then(foundPaths => {
      browsers.browserDbLocations.maxthon = foundPaths
    })
  ]
  Promise.all(getPaths).then(() => {
    let getRecords = [
      getBrowserHistory(browsers.browserDbLocations.maxthon, browsers.MAXTHON, historyTimeLength)
    ]
    Promise.all(getRecords).then((records) => {
      return records
    }, error => {
      throw error
    })
  }, error => {
    throw error
  })
}

/**
 * Get Vivaldi History
 * @param historyTimeLength time is in minutes
 * @returns {Promise<array>}
 */
async function getVivaldiHistory(historyTimeLength = 5) {
  let getPaths = [
    browsers.findPaths(browsers.defaultPaths.vivaldi, browsers.VIVALDI).then(foundPaths => {
      browsers.browserDbLocations.vivaldi = foundPaths
    })
  ]
  Promise.all(getPaths).then(() => {
    let getRecords = [
      getBrowserHistory(browsers.browserDbLocations.vivaldi, browsers.VIVALDI, historyTimeLength)
    ]
    Promise.all(getRecords).then((records) => {
      return records
    }, error => {
      throw error
    })
  }, error => {
    throw error
  })
}

/**
 * Get Internet Explorer History
 * @param historyTimeLength time is in minutes
 * @returns {Promise<array>}
 */
async function getIEHistory(historyTimeLength = 5) {
  let getRecords = [
    getBrowserHistory([], browsers.INTERNETEXPLORER, historyTimeLength)
  ]
  Promise.all(getRecords).then((records) => {
    return records
  }, error => {
    throw error
  })
}

/**
 * Gets the history for the Specified browsers and time in minutes.
 * Returns an array of browser records.
 * @param historyTimeLength | Integer
 * @returns {Promise<array>}
 */
async function getAllHistory(historyTimeLength = 5) {
  let allBrowserRecords = []

  browsers.browserDbLocations.firefox = browsers.findPaths(browsers.defaultPaths.firefox, browsers.FIREFOX)
  browsers.browserDbLocations.chrome = browsers.findPaths(browsers.defaultPaths.chrome, browsers.CHROME)
  browsers.browserDbLocations.seamonkey = browsers.findPaths(browsers.defaultPaths.seamonkey, browsers.SEAMONKEY)
  browsers.browserDbLocations.opera = browsers.findPaths(browsers.defaultPaths.opera, browsers.OPERA)
  browsers.browserDbLocations.torch = browsers.findPaths(browsers.defaultPaths.torch, browsers.TORCH)
  browsers.browserDbLocations.safari = browsers.findPaths(browsers.defaultPaths.safari, browsers.SAFARI)
  browsers.browserDbLocations.seamonkey = browsers.findPaths(browsers.defaultPaths.seamonkey, browsers.SEAMONKEY)
  browsers.browserDbLocations.maxthon = browsers.findPaths(browsers.defaultPaths.maxthon, browsers.MAXTHON)
  browsers.browserDbLocations.vivaldi = browsers.findPaths(browsers.defaultPaths.vivaldi, browsers.VIVALDI)

  allBrowserRecords = allBrowserRecords.concat(await getBrowserHistory(browsers.browserDbLocations.firefox, browsers.FIREFOX, historyTimeLength))
  allBrowserRecords = allBrowserRecords.concat(await getBrowserHistory(browsers.browserDbLocations.seamonkey, browsers.SEAMONKEY, historyTimeLength))
  allBrowserRecords = allBrowserRecords.concat(await getBrowserHistory(browsers.browserDbLocations.chrome, browsers.CHROME, historyTimeLength))
  allBrowserRecords = allBrowserRecords.concat(await getBrowserHistory(browsers.browserDbLocations.opera, browsers.OPERA, historyTimeLength))
  allBrowserRecords = allBrowserRecords.concat(await getBrowserHistory(browsers.browserDbLocations.torch, browsers.TORCH, historyTimeLength))
  allBrowserRecords = allBrowserRecords.concat(await getBrowserHistory(browsers.browserDbLocations.safari, browsers.SAFARI, historyTimeLength))
  allBrowserRecords = allBrowserRecords.concat(await getBrowserHistory(browsers.browserDbLocations.vivaldi, browsers.VIVALDI, historyTimeLength))
  allBrowserRecords = allBrowserRecords.concat(await getBrowserHistory(browsers.browserDbLocations.seamonkey, browsers.SEAMONKEY, historyTimeLength))
  allBrowserRecords = allBrowserRecords.concat(await getBrowserHistory(browsers.browserDbLocations.maxthon, browsers.MAXTHON, historyTimeLength))
  //No Path because this is handled by the dll
  allBrowserRecords = allBrowserRecords.concat(await getBrowserHistory([], browsers.INTERNETEXPLORER, historyTimeLength))

  return allBrowserRecords
}

module.exports = {
  getAllHistory,
  getFirefoxHistory,
  getSeaMonkeyHistory,
  getChromeHistory,
  getOperaHistory,
  getTorchHistory,
  getSafariHistory,
  getMaxthonHistory,
  getVivaldiHistory,
  getIEHistory
}