// collection of IDs so that the timers can be cleared
const IDs = new Map();
// variable to keep track of and return a new ID
let newID = 1;
const rate = 0.9;
// number of ms in a min
const conversionFactor = 60 * 1000;
const minsInOneDay = 60 * 24;
// the max ms setTimeout can use
const maxDelay = 2 ** 31 - 1;

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
 * converts hr and min to mins
 * 
 * @param {Number} hour 
 * @param {Number} minute 
 * @returns mins
 */
function convertTimeToMins(hour, minute) {
    return 60 * hour + minute;
}

/**
 * converts mins to hr and min
 * 
 * @param {Number} mins 
 * @returns hr and min object
 */
function convertMinsToHrAndMin(mins) {
    return {
        hour: Math.trunc(mins / 60),
        minute: mins % 60
    };
}

/**
 * returns the time (hour and minute) in mins
 * 
 * @param {Date} time Date object
 * @returns mins
 */
function getTimeInMins(time) {
    return convertTimeToMins(time.getHours(), time.getMinutes());
}

/**
 * calculates the interval time based on a given current time, interval amount, and the interval starting time
 * 
 * @param {Number} currentTime units since utc
 * @param {Number} interval units
 * @param {Number} epoch units since utc
 * @param {Function} func takes a parameter 'n', 'n' is the n-th interval, it should manipulate and return 'n'
 * @returns total time (in the numbers units) since utc epoch
 */
function formula(currentTime, interval, epoch, func) {
    /*
        // formula
        // 'interval' and 'startTime' are in some selected unit

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

        n = truncate(func(n))

        newIntervalTime = interval * n + startTime

        // the result is the next time interval in the appropriate untis
    */

    return Math.trunc(func((currentTime - epoch) / interval)) * interval + epoch;
}

/**
 * 
 * @param {Date} date Date object
 */
function subtractAMonth(date) {
    const current = date.getMonth();

    while (current === date.getMonth()) {
        date.setMonth(date.getMonth() - 1);
    }
}

/**
 * 
 * @param {Date} date Date object
 * @returns absolute value of daylight savings offset in mins
 */
function getDaylightSavingsOffset(date) {
    const currentMonth = date.getMonth();
    const currentOffset = date.getTimezoneOffset();
    const compare = new Date(date);

    // going back to a previous month that has less days will cause the date object to still have the same month
    subtractAMonth(compare);

    while (currentMonth !== compare.getMonth()) {
        const compareOffset = compare.getTimezoneOffset();

        if (currentOffset !== compareOffset) {
            return Math.abs(currentOffset - compareOffset);
        }

        subtractAMonth(compare);
    }

    return 0;
}

/**
 * sets the correct time for the intervalTime object
 * 
 * @param {Date} intervalTime Data object
 * @param {Number} interval ms
 * @param {Object} epoch object from createEpoch()
 */
function adjustIntervalTime(intervalTime, interval, epoch) {
    // calculate the correct interval time and adjust the interval

    const adjustedInterval = Math.trunc(interval / conversionFactor) % minsInOneDay;
    let correctIntervalTime = undefined;

    if (adjustedInterval > 0) {
        correctIntervalTime = convertMinsToHrAndMin(formula(getTimeInMins(intervalTime), adjustedInterval, convertTimeToMins(epoch.hour, epoch.minute), (n) => {
            return n;
        }));
    }
    else {
        correctIntervalTime = {
            hour: epoch.hour,
            minute: epoch.minute
        };
    }

    // the case where daylight savings sets the time forwards
    intervalTime.setHours(correctIntervalTime.hour, correctIntervalTime.minute);

    // the case where daylight savings sets the time backwards
    // add the daylight savings offset to the interval if the adjusted interval is before the current time
    const now = new Date();

    if (intervalTime.valueOf() < now.valueOf()) {
        intervalTime.setUTCMinutes(intervalTime.getUTCMinutes() + getDaylightSavingsOffset(now));

        // this handles the case where the interval was started on the time of the daylight savings execution time
        if (intervalTime.valueOf() <= now.valueOf()) {
            intervalTime.setTime(intervalTime.valueOf() + interval);
            adjustIntervalTime(intervalTime, interval, epoch);
        }
    }
}

/**
 * sets the next interval time
 * 
 * @param {Date} intervalTime Date object
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
 * @param {Number} hour 
 * @param {Number} minute 
 * @returns epoch object
 */
function createEpoch(hour, minute) {
    return {
        UTCValue: new Date().setHours(hour, minute, 0, 0),
        hour: hour,
        minute: minute
    };
}

/**
 * 
 * @param {Number} intervalTime ms
 * @returns ms
 */
function calculateDelay(intervalTime) {
    const difference = intervalTime - Date.now();

    if (difference > maxDelay) {
        return rate * maxDelay;
    }

    return rate * difference;
}

/**
 * calls timeout repeatedly
 * 
 * @param {Function} callback function
 * @param {Number} ID int
 * @param {Number} interval ms
 * @param {Date} intervalTime Data object
 * @param {Object} epoch object from createEpoch()
 */
function customInterval(callback, ID, interval, intervalTime, epoch) {
    IDs.set(
        ID,
        setTimeout(() => {
            const time = Date.now();
            const utcIntervalTime = intervalTime.valueOf();

            if (utcIntervalTime <= time) {
                intervalTime.setTime(utcIntervalTime + interval);

                if (intervalTime.valueOf() < time) {
                    // system time changes greater than the interval time
                    epoch = createEpoch(epoch.hour, epoch.minute);
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
                if (utcIntervalTime - time > interval) {
                    epoch = createEpoch(epoch.hour, epoch.minute);
                    setNextIntervalTime(intervalTime, interval, epoch);
                }
            }

            customInterval(callback, ID, interval, intervalTime, epoch);
        }, calculateDelay(intervalTime.valueOf()))
    );
}

/**
 * starts an interval based on the time
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

    interval *= conversionFactor;

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
