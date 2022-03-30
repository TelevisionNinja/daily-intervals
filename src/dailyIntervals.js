// collection of IDs so that the timers can be cleared
const IDs = new Map();
// variable to keep track of and return a new ID
let newID = 1;
const rate = 0.9;
// number of ms in a min
const conversionFactor = 60 * 1000;
const msInADay = conversionFactor * 60 * 24;

/**
 * creates a function if the callback is a string
 * 
 * @param {Function} callback 
 * @param {...any} args 
 * @returns 
 */
function createCallback(callback, args) {
    if (typeof callback === 'function') {
        return () => callback(...args);
    }

    return Function(...args, callback);
}

/**
 * 
 * @param {String} str format: 24 hr time h:m
 * @returns array
 */
function parseTimeStr(str) {
    return str.split(':').map(i => parseInt(i));
}

/**
 * converts hrs and mins to mins
 * @param {Number} hrs 
 * @param {Number} mins 
 * @returns ms
 */
function convertTimeToMs(hrs, mins) {
    return (60 * hrs + mins) * conversionFactor;
}

/**
 * converts ms to hrs and mins
 * 
 * @param {Number} ms 
 * @returns hrs and mins object
 */
function convertMsToHrAndMins(ms) {
    const mins = Math.trunc(ms / conversionFactor);

    return {
        hrs: Math.trunc(mins / 60),
        mins: mins % 60
    };
}

/**
 * converts mins to ms
 * @param {Number} mins mins
 * @returns ms
 */
function convertMinsToMs(mins) {
    return conversionFactor * mins;
}

/**
 * returns the time (hours and minutes) in ms
 * 
 * @param {Object} time Date object
 * @returns ms
 */
function getTimeInMs(time) {
    return convertTimeToMs(time.getHours(), time.getMinutes()); 
}

/**
 * calculates the interval time based on a given current time, interval amount, and the interval starting time
 * 
 * @param {Number} currentTime utc mc
 * @param {Number} interval ms
 * @param {Number} epoch utc ms
 * @param {Function} func takes a parameter 'n', 'n' is the n-th interval, it should manipulate and return 'n'
 * @returns ms
 */
function formula(currentTime, interval, epoch, func) {
    /*
        // formula
        // 'interval' and 'startTime' are in some selected unit
        // division is integer division

        // remove offset (startTime)
        delta = currentTime - startTime

        n = delta / interval

        // func to get the next interval
        func(n) {
            // for negative deltas, return the nearest interval
            if (n >= 0) {
                return n + 1;
            }

            return n;
        }

        n = func(n)

        newIntervalTime = interval * n + startTime

        // the result is the next time interval in the appropriate untis
    */

    return Math.trunc(func((currentTime - epoch) / interval)) * interval + epoch;
}

/**
 * 
 * @returns daylight savings offset from UTC in mins
 */
function getDaylightSavingsOffset() {
    const currentYr = new Date();
    const january = new Date(currentYr.getFullYear(), 0, 1);
    const july = new Date(currentYr.getFullYear(), 6, 1);
    return Math.abs(Math.abs(january.getTimezoneOffset()) - Math.abs(july.getTimezoneOffset()));
}

/**
 * sets the correct time for the intervalTime object
 * 
 * @param {Object} intervalTime Data object
 * @param {Number} interval ms
 * @param {Object} epoch object from createEpoch()
 */
function adjustIntervalTime(intervalTime, interval, epoch) {
    // calculate the correct interval time and adjust the interval

    const adjustedInterval = interval % msInADay;
    let correctIntervalTime = undefined;

    if (adjustedInterval > 0) {
        correctIntervalTime = convertMsToHrAndMins(formula(getTimeInMs(intervalTime), adjustedInterval, convertTimeToMs(epoch.hrs, epoch.mins), (n) => {
            return n;
        }));
    }
    else {
        correctIntervalTime = {
            hrs: epoch.hrs,
            mins: epoch.mins
        };
    }

    intervalTime.setHours(correctIntervalTime.hrs, correctIntervalTime.mins);

    // the case where daylight savings sets the time backwards
    // add the daylight savings offset to the interval if the adjusted interval is before the current time
    if (intervalTime.valueOf() < Date.now()) {
        intervalTime.setUTCMinutes(intervalTime.getUTCMinutes() + getDaylightSavingsOffset());
    }
}

/**
 * sets the next interval time based
 * 
 * @param {Object} intervalTime Date object
 * @param {Number} interval ms
 * @param {Object} epoch object from createEpoch()
 */
function setNextIntervalTime(intervalTime, interval, epoch) {
    intervalTime.setTime(formula(Date.now(), interval, epoch.UTCValue, (n) => {
        // for negative deltas, return the nearest interval
        if (n >= 0) {
            return n + 1;
        }

        return n;
    }));

    // the set time could have the wrong hrs and mins bc of daylight savings
    adjustIntervalTime(intervalTime, interval, epoch);
}

/**
 * creates a time interval Date object
 * 
 * @param {Number} interval ms
 * @param {Object} epoch object from createEpoch()
 * @returns Date object
 */
function createTimeInterval(interval, epoch) {
    const intervalTime = new Date();
    setNextIntervalTime(intervalTime, interval, epoch);
    return intervalTime;
}

/**
 * create a starting time for the intervals
 * 
 * @param {Number} hrs 
 * @param {Number} mins 
 * @returns epoch object
 */
function createEpoch(hrs, mins) {
    const epochDate = new Date();
    epochDate.setHours(hrs, mins, 0, 0);

    return {
        UTCValue: epochDate.valueOf(),
        hrs: hrs,
        mins: mins
    };
}

/**
 * calls timeout repeatedly
 * 
 * @param {Function} callback function
 * @param {Number} ID int
 * @param {Number} interval ms
 * @param {Object} intervalTime Data object
 * @param {Object} epoch object from createEpoch()
 */
function customInterval(callback, ID, interval, intervalTime, epoch) {
    IDs.set(
        ID,
        setTimeout(() => {
            const time = Date.now();

            if (intervalTime.valueOf() <= time) {
                intervalTime.setTime(intervalTime.valueOf() + interval);

                if (intervalTime.valueOf() < time) {
                    // system time changes greater than the interval time
                    epoch = createEpoch(epoch.hrs, epoch.mins);
                    setNextIntervalTime(intervalTime, interval, epoch);
                }
                else {
                    callback();
                    // daylight savings adjustment
                    adjustIntervalTime(intervalTime, interval, epoch);
                }
            }
            else {
                // system time changes less than the interval time
                if (intervalTime.valueOf() - time > interval) {
                    epoch = createEpoch(epoch.hrs, epoch.mins);
                    setNextIntervalTime(intervalTime, interval, epoch);
                }
            }

            customInterval(callback, ID, interval, intervalTime, epoch);
        }, rate * (intervalTime.valueOf() - Date.now()))
    );
}

/**
 * calls timeout repeatedly
 * 
 * @param {Function} callback func to execute at every interval
 * @param {Number} interval mins between intervals, default: 1
 * @param {String} startingTime starting time of the intervals, format: 24 hour time 'h:m', default value: '0:0'
 * @param  {...any} args args of the callback func
 * @returns an ID
 */
export function setDailyInterval(callback, interval = 1, startingTime = '0:0', ...args) {
    if (interval < 1) {
        interval = 1;
    }

    interval = convertMinsToMs(interval);

    const timeArr = parseTimeStr(startingTime);
    const epoch = createEpoch(timeArr[0], timeArr[1]);

    // start the interval
    customInterval(createCallback(callback, args), newID, interval, createTimeInterval(interval, epoch), epoch);

    return newID++;
}

/**
 * cancels a daily interval
 * 
 * @param {Number} ID 
 */
export function clearDailyInterval(ID) {
    clearTimeout(IDs.get(ID));
    IDs.delete(ID);
}
