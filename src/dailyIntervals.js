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
    const shiftDay = date.timeZone.getPreviousTransition(date);

    if (shiftDay === null) {
        return 0;
    }

    const shiftDayZonedDate = shiftDay.toZonedDateTime({
        calendar: date.calendar,
        timeZone: date.timeZone
    });

    const previousOffest = shiftDayZonedDate.subtract({
        days: 1
    }).offsetNanoseconds;

    const nextOffest = shiftDayZonedDate.add({
        days: 1
    }).offsetNanoseconds;

    return Math.abs(nextOffest - previousOffest);
}

/**
 * calculates the interval time based on a given current time, interval amount, and the interval starting time
 * 
 * @param {Number | BigInt} currentTime units since utc
 * @param {Number | BigInt} interval 
 * @param {Number | BigInt} epoch units since utc
 * @param {Function} func takes a parameter 'd' and 'n', 'd' is the difference bettwen the current time and epoch, 'n' is the interval amount, it should manipulate 'd' and 'n' and return the desired nth interval
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
        func(d, n) {
            // for negative deltas, return the nearest interval
            if (d >= 0) {
                return d / n + 1;
            }

            return d / n;
        }

        n = func(delta, interval)

        newIntervalTime = interval * n + startTime

        // the result is the next time interval in the appropriate untis
    */

    return func(currentTime - epoch, interval) * interval + epoch;
}

/**
 * sets the correct time for the intervalTime object
 * 
 * @param {Temporal.ZonedDateTime} intervalTime Temporal object
 * @param {Number} interval mins
 * @param {Object} epoch object from createEpoch()
 * @param {Number} adjustedInterval mins
 * @param {Temporal.ZonedDateTime} currentTime Temporal object
 * @returns Temporal object
 */
function adjust(intervalTime, interval, epoch, adjustedInterval, currentTime) {
    // calculate the correct interval time and adjust the interval
    let correctIntervalTime = undefined;

    if (adjustedInterval === 0) {
        correctIntervalTime = {
            hour: epoch.hour,
            minute: epoch.minute
        };
    }
    else {
        correctIntervalTime = convertMinsToHrAndMins(formula(getTimeInMins(intervalTime), adjustedInterval, getTimeInMins(epoch), (d, n) => {
            return Math.trunc(d / n);
        }));
    }

    // the case where daylight savings sets the time forwards
    intervalTime = intervalTime.withPlainTime(correctIntervalTime);

    // the case where daylight savings sets the time backwards
    // add the daylight savings offset to the interval if the adjusted interval is before the current time
    if (intervalTime.epochNanoseconds < currentTime.epochNanoseconds) {
        intervalTime = intervalTime.add({
            nanoseconds: getDaylightSavingsOffset(currentTime)
        });

        // this handles the case where the interval was started on the time of the daylight savings execution time
        if (intervalTime.epochNanoseconds <= currentTime.epochNanoseconds) {
            intervalTime = intervalTime.add({
                minutes: interval
            });

            intervalTime = adjust(intervalTime, interval, epoch, adjustedInterval, currentTime);
        }
    }

    return intervalTime;
}

/**
 * sets the correct time for the intervalTime object
 * 
 * @param {Temporal.ZonedDateTime} intervalTime Temporal object
 * @param {BigInt} interval ns
 * @param {Object} epoch object from createEpoch()
 * @param {Temporal.ZonedDateTime} currentTime Temporal object
 * @returns Temporal object
 */
function adjustIntervalTime(intervalTime, interval, epoch, currentTime) {
    const convertedInterval = Number(interval / conversionFactor);
    return adjust(intervalTime, convertedInterval, epoch, convertedInterval % minsInADay, currentTime);
}

/**
 * creates a time interval Temporal object
 * 
 * @param {BigInt} interval ns
 * @param {Object} epoch object from createEpoch()
 * @param {Temporal.ZonedDateTime} currentTime Temporal object
 * @returns Temporal object
 */
function createTimeInterval(interval, epoch, currentTime) {
    const nextInterval = new Temporal.ZonedDateTime(formula(currentTime.epochNanoseconds, interval, epoch.UTCValue, (d, n) => {
        // for negative deltas, return the nearest interval
        if (d >= 0n) {
            return d / n + 1n;
        }

        return d / n;
    }), currentTime.timeZone, currentTime.calendar);

    // the set time could have the wrong hrs and mins bc of daylight savings
    return adjustIntervalTime(nextInterval, interval, epoch, currentTime);
}

/**
 * create a starting time for the intervals
 * 
 * @param {Temporal.ZonedDateTime} currentTime Temporal object
 * @param {Number} hr 
 * @param {Number} min 
 * @returns epoch object
 */
function createEpoch(currentTime, hr, min) {
    const epoch = currentTime.withPlainTime({
        hour: hr,
        minute: min
    }).epochNanoseconds;

    return {
        UTCValue: epoch,
        hour: hr,
        minute: min
    };
}

/**
 * 
 * @param {Number} intervalTime ms
 * @param {Number} curentTime ms
 * @returns ms
 */
function calculateDelay(intervalTime, curentTime) {
    const difference = intervalTime - curentTime;

    if (difference > maxDelay) {
        return rate * maxDelay;
    }

    return rate * difference;
}

/**
 * calls timeout repeatedly
 * 
 * @param {Number} currentTime utc ms
 * @param {Function} callback function
 * @param {Number} ID int
 * @param {BigInt} interval ns
 * @param {Temporal.ZonedDateTime} intervalTime Temporal object
 * @param {Object} epoch object from createEpoch()
 */
function customInterval(currentTime, callback, ID, interval, intervalTime, epoch) {
    IDs.set(
        ID,
        setTimeout(() => {
            const now = getZonedDateTime();

            if (intervalTime.epochNanoseconds <= now.epochNanoseconds) {
                intervalTime = intervalTime.add({
                    nanoseconds: Number(interval)
                });

                if (intervalTime.epochNanoseconds < now.epochNanoseconds) {
                    // system time changes greater than the interval time
                    epoch = createEpoch(now, epoch.hour, epoch.minute);
                    intervalTime = createTimeInterval(interval, epoch, now);
                }
                else {
                    callback();
                    // daylight savings adjustment
                    intervalTime = adjustIntervalTime(intervalTime, interval, epoch, now);
                }
            }
            else {
                // system time changes less than the interval time
                if (intervalTime.epochNanoseconds - now.epochNanoseconds > interval) {
                    epoch = createEpoch(now, epoch.hour, epoch.minute);
                    intervalTime = createTimeInterval(interval, epoch, now);
                }
            }

            customInterval(now.epochMilliseconds, callback, ID, interval, intervalTime, epoch);
        }, calculateDelay(intervalTime.epochMilliseconds, currentTime))
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

    const convertedInterval = BigInt(interval) * conversionFactor;
    const timeArr = parseTimeStr(startingTime);
    const currentTime = getZonedDateTime();
    const epoch = createEpoch(currentTime, timeArr[0], timeArr[1]);

    // start the interval
    customInterval(currentTime.epochMilliseconds, createCallback(callback, args), newID, convertedInterval, createTimeInterval(convertedInterval, epoch, currentTime), epoch);

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
