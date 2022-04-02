import { Temporal } from "@js-temporal/polyfill";

// collection of IDs so that the timers can be cleared
const IDs = new Map();
// variable to keep track of and return a new ID
let newID = 1;
const rate = 0.9;
// number of ns in a min
const conversionFactor = 60n * 1000n * 1000n * 1000n;
const minsInADay = 60 * 24;
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
 * converts hrs and mins to mins
 * 
 * @param {Number} hrs 
 * @param {Number} mins 
 * @returns mins
 */
function convertTimeToMins(hrs, mins) {
    return 60 * hrs + mins;
}

/**
 * converts mins to hrs and mins
 * 
 * @param {Number} mins 
 * @returns hrs and mins object
 */
function convertMinsToHrAndMins(mins) {
    return {
        hour: Math.trunc(mins / 60),
        minute: mins % 60
    };
}

/**
 * returns the time (hours and minutes) in mins
 * 
 * @param {Temporal.ZonedDateTime} time Temporal object
 * @returns mins
 */
function getTimeInMins(time) {
    return convertTimeToMins(time.hour, time.minute); 
}

/**
 * 
 * @returns the system calendar
 */
function getCalendar() {
    const calendar = new Intl.DateTimeFormat().resolvedOptions().calendar;

    if (calendar === 'gregory') {
        return 'iso8601';
    }

    return calendar;
}

/**
 * 
 * @returns Temporal zonedDateTime object using the system's calendar
 */
function getZonedDateTime() {
    return Temporal.Now.zonedDateTime(getCalendar());
}

/**
 * 
 * @param {Temporal.ZonedDateTime} date Temporal zonedDateTime object
 * @returns absolute value of daylight savings offset in ns
 */
function getDaylightSavingsOffset(date) {
    for (let i = 1; i < date.monthsInYear; i++) {
        const compare = date.subtract({
            months: i
        });

        if (date.offsetNanoseconds !== compare.offsetNanoseconds) {
            return Math.abs(Math.abs(date.offsetNanoseconds) - Math.abs(compare.offsetNanoseconds));
        }
    }

    return 0;
}

/**
 * calculates the interval time based on a given current time, interval amount, and the interval starting time
 * 
 * @param {Number | BigInt} currentTime units since utc
 * @param {Number | BigInt} interval 
 * @param {Number | BigInt} epoch units since utc
 * @param {Function} func takes a parameter 'n', 'n' is the difference bettwen the current time and epoch, it should manipulate and return 'n'
 * @returns total time (in the numbers units) since utc epoch
 */
function formula(currentTime, interval, epoch, func) {
    /*
        // formula
        // 'interval' and 'startTime' are in some selected unit
        // division is integer division

        // remove offset (startTime)
        delta = currentTime - startTime

        // func to get the next interval
        func(d) {
            // for negative deltas, return the nearest interval
            if (d >= 0) {
                return d + interval;
            }

            return d;
        }

        n = func(delta) / interval

        newIntervalTime = interval * n + startTime

        // the result is the next time interval in the appropriate untis
    */

    return func(currentTime - epoch) / interval * interval + epoch;
}

/**
 * sets the correct time for the intervalTime object
 * 
 * @param {Temporal.ZonedDateTime} intervalTime Temporal object
 * @param {Number} interval mins
 * @param {Object} epoch object from createEpoch()
 * @returns Temporal object
 */
function adjustIntervalTime(intervalTime, interval, epoch) {
    // calculate the correct interval time and adjust the interval

    const adjustedInterval = interval % minsInADay;
    let correctIntervalTime = undefined;

    if (adjustedInterval > 0) {
        correctIntervalTime = convertMinsToHrAndMins(formula(getTimeInMins(intervalTime), adjustedInterval, getTimeInMins(epoch), (n) => {
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
    intervalTime = intervalTime.withPlainTime(correctIntervalTime);

    // the case where daylight savings sets the time backwards
    // add the daylight savings offset to the interval if the adjusted interval is before the current time
    const now = getZonedDateTime();

    if (intervalTime.epochNanoseconds < now.epochNanoseconds) {
        intervalTime = intervalTime.add({
            nanoseconds: getDaylightSavingsOffset(now)
        });

        // this handles the case where the interval was started on the time of the daylight savings execution time
        if (intervalTime.epochNanoseconds <= now.epochNanoseconds) {
            intervalTime = intervalTime.add({
                minutes: interval
            });

            intervalTime = adjustIntervalTime(intervalTime, interval, epoch);
        }
    }

    return intervalTime;
}

/**
 * creates a time interval Temporal object
 * 
 * @param {Number} interval mins
 * @param {Object} epoch object from createEpoch()
 * @returns Temporal object
 */
function createTimeInterval(interval, epoch) {
    const bigIntInterval = BigInt(interval) * conversionFactor;
    const nextInterval = new Temporal.ZonedDateTime(formula(Temporal.Now.instant().epochNanoseconds, bigIntInterval, epoch.UTCValue, (n) => {
        // for negative deltas, return the nearest interval
        if (n >= 0n) {
            return n + bigIntInterval;
        }

        return n;
    }), Temporal.Now.timeZone(), getCalendar());

    // the set time could have the wrong hrs and mins bc of daylight savings
    return adjustIntervalTime(nextInterval, interval, epoch);
}

/**
 * create a starting time for the intervals
 * 
 * @param {Number} hr 
 * @param {Number} min 
 * @returns epoch object
 */
function createEpoch(hr, min) {
    const epochDate = getZonedDateTime().withPlainTime({
        hour: hr,
        minute: min
    });

    return {
        UTCValue: epochDate.epochNanoseconds,
        hour: hr,
        minute: min
    };
}

/**
 * 
 * @param {Number} intervalTime ms
 * @returns ms
 */
function calculateDelay(intervalTime) {
    const difference = intervalTime - Temporal.Now.instant().epochMilliseconds;

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
 * @param {Number} interval mins
 * @param {Temporal.ZonedDateTime} intervalTime Temporal object
 * @param {Object} epoch object from createEpoch()
 */
function customInterval(callback, ID, interval, intervalTime, epoch) {
    IDs.set(
        ID,
        setTimeout(() => {
            const time = Temporal.Now.instant().epochNanoseconds;

            if (intervalTime.epochNanoseconds <= time) {
                intervalTime = intervalTime.add({
                    minutes: interval
                });

                if (intervalTime.epochNanoseconds < time) {
                    // system time changes greater than the interval time
                    epoch = createEpoch(epoch.hour, epoch.minute);
                    intervalTime = createTimeInterval(interval, epoch);
                }
                else {
                    callback();
                    // daylight savings adjustment
                    intervalTime = adjustIntervalTime(intervalTime, interval, epoch);
                }
            }
            else {
                // system time changes less than the interval time
                if (intervalTime.epochNanoseconds - time > interval) {
                    epoch = createEpoch(epoch.hour, epoch.minute);
                    intervalTime = createTimeInterval(interval, epoch);
                }
            }

            customInterval(callback, ID, interval, intervalTime, epoch);
        }, calculateDelay(intervalTime.epochMilliseconds))
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
