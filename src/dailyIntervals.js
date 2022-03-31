import { Temporal } from "@js-temporal/polyfill";

// collection of IDs so that the timers can be cleared
const IDs = new Map();
// variable to keep track of and return a new ID
let newID = 1;
const rate = 0.9;
// number of ns in a min
const conversionFactor = 60n * 1000n * 1000n * 1000n;
const nsInADay = conversionFactor * 60n * 24n;
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
 * converts hrs and mins to ns
 * 
 * @param {Number} hrs 
 * @param {Number} mins 
 * @returns ns
 */
function convertTimeToNs(hrs, mins) {
    return (60n * BigInt(hrs) + BigInt(mins)) * conversionFactor;
}

/**
 * converts ns to hrs and mins
 * 
 * @param {BigInt} ns 
 * @returns hrs and mins object
 */
function convertNsToHrAndMins(ns) {
    const mins = ns / conversionFactor;

    return {
        hrs: Number(mins / 60n),
        mins: Number(mins % 60n)
    };
}

/**
 * converts mins to ns
 * 
 * @param {BigInt} mins mins
 * @returns ns
 */
function convertMinsToNs(mins) {
    return conversionFactor * mins;
}

/**
 * returns the time (hours and minutes) in ns
 * 
 * @param {Object} time Temporal object
 * @returns ns
 */
function getTimeInNs(time) {
    return convertTimeToNs(time.hour, time.minute); 
}

/**
 * calculates the interval time based on a given current time, interval amount, and the interval starting time
 * 
 * @param {BigInt} currentTime utc ns
 * @param {BigInt} interval ns
 * @param {BigInt} epoch utc ns
 * @param {Function} func takes a parameter 'n', 'n' is the n-th interval, it should manipulate and return 'n'
 * @returns ns
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

    return func(currentTime - epoch) / interval * interval + epoch;
}

/**
 * absolute value of big int
 * 
 * @param {BigInt} n 
 * @returns big int
 */
function absoluteValue(n) {
    if (n >= 0n) {
        return n;
    }

    return -n;
}

/**
 * 
 * @returns daylight savings offset from UTC in ns
 */
function getDaylightSavingsOffset() {
    const currentYr = Temporal.Now.zonedDateTimeISO().year;
    const january = Temporal.Now.zonedDateTimeISO().withPlainDate({
        year: currentYr,
        month: 1,
        day: 1
    });
    const july = Temporal.Now.zonedDateTimeISO().withPlainDate({
        year: currentYr,
        month: 7,
        day: 1
    });
    const offset = absoluteValue(absoluteValue(january.offsetNanoseconds) - absoluteValue(july.offsetNanoseconds));
    return Number(offset);
}

/**
 * sets the correct time for the intervalTime object
 * 
 * @param {Object} intervalTime Temporal object
 * @param {BigInt} interval ns
 * @param {Object} epoch object from createEpoch()
 */
function adjustIntervalTime(intervalTime, interval, epoch) {
    // calculate the correct interval time and adjust the interval

    const adjustedInterval = interval % nsInADay;
    let correctIntervalTime = undefined;

    if (adjustedInterval > 0) {
        correctIntervalTime = convertNsToHrAndMins(formula(getTimeInNs(intervalTime), adjustedInterval, convertTimeToNs(epoch.hrs, epoch.mins), (n) => {
            return n;
        }));
    }
    else {
        correctIntervalTime = {
            hrs: epoch.hrs,
            mins: epoch.mins
        };
    }

    intervalTime = intervalTime.withPlainTime({
        hour: correctIntervalTime.hrs,
        minute: correctIntervalTime.mins
    });

    // the case where daylight savings sets the time backwards
    // add the daylight savings offset to the interval if the adjusted interval is before the current time
    const now = Temporal.Now.instant().epochNanoseconds;

    if (intervalTime.epochNanoseconds < now) {
        intervalTime = intervalTime.add({
            nanoseconds: getDaylightSavingsOffset()
        });

        // this handles the case where the interval was started on the time of the daylight savings execution time
        if (intervalTime.epochNanoseconds <= now) {
            intervalTime = intervalTime.add({
                nanoseconds: Number(interval)
            });

            intervalTime = adjustIntervalTime(intervalTime, interval, epoch);
        }
    }

    return intervalTime;
}

/**
 * creates a time interval Temporal object
 * 
 * @param {BigInt} interval ns
 * @param {Object} epoch object from createEpoch()
 * @returns Temporal object
 */
function createTimeInterval(interval, epoch) {
    const nextInterval = new Temporal.ZonedDateTime(formula(Temporal.Now.instant().epochNanoseconds, interval, epoch.UTCValue, (n) => {
        // for negative deltas, return the nearest interval
        if (n >= 0n) {
            return n + interval;
        }

        return n;
    }), Temporal.Now.timeZone());

    // the set time could have the wrong hrs and mins bc of daylight savings
    return adjustIntervalTime(nextInterval, interval, epoch);
}

/**
 * create a starting time for the intervals
 * 
 * @param {Number} hrs 
 * @param {Number} mins 
 * @returns epoch object
 */
function createEpoch(hrs, mins) {
    const epochDate = Temporal.Now.zonedDateTimeISO().withPlainTime({
        hour: hrs,
        minute: mins
    });

    return {
        UTCValue: epochDate.epochNanoseconds,
        hrs: hrs,
        mins: mins
    };
}

/**
 * 
 * @param {Number} intervalTime 
 * @returns ms
 */
function calculateDelay(intervalTime) {
    const difference = intervalTime - Temporal.Now.instant().epochMilliseconds;

    if (difference > maxDelay) {
        return maxDelay;
    }

    return difference;
}

/**
 * calls timeout repeatedly
 * 
 * @param {Function} callback function
 * @param {Number} ID int
 * @param {BigInt} interval ns
 * @param {Object} intervalTime Temporal object
 * @param {Object} epoch object from createEpoch()
 */
function customInterval(callback, ID, interval, intervalTime, epoch) {
    IDs.set(
        ID,
        setTimeout(() => {
            const time = Temporal.Now.instant().epochNanoseconds;

            if (intervalTime.epochNanoseconds <= time) {
                intervalTime = intervalTime.add({
                    nanoseconds: Number(interval)
                });

                if (intervalTime.epochNanoseconds < time) {
                    // system time changes greater than the interval time
                    epoch = createEpoch(epoch.hrs, epoch.mins);
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
                    epoch = createEpoch(epoch.hrs, epoch.mins);
                    intervalTime = createTimeInterval(interval, epoch);
                }
            }

            customInterval(callback, ID, interval, intervalTime, epoch);
        }, rate * calculateDelay(intervalTime.epochMilliseconds))
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

    interval = convertMinsToNs(BigInt(interval));

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
