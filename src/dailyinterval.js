// collection of IDs so that the timers can be cleared
const IDs = new Map();
// variable to keep track of and return a new ID
let newID = 1;
const rate = 0.9;
// number of ms in a min
const conversionFactor = 60 * 1000;

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
 * @returns mins
 */
function convertTimeToMs(hrs, mins) {
    return (60 * hrs + mins) * conversionFactor;
}

/**
 * 
 * @param {Array} arr array from parseTimeStr()
 * @returns ms
 */
function timeArrToMs(arr) {
    return convertTimeToMs(...arr);
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
 * sets the correct time for the intervalTime object
 * 
 * @param {Object} intervalTime Data object
 * @param {Number} interval ms
 */
function adjustIntervalTime(intervalTime, interval) {
    const correctIntervalTime = convertMsToHrAndMins(Math.trunc(getTimeInMs(intervalTime) / interval) * interval);

    const currentHr = intervalTime.getHours();
    const currentMin = intervalTime.getMinutes();
    const hrDelta = correctIntervalTime.hrs - currentHr;
    const minDelta = correctIntervalTime.mins - currentMin;
    const previous = intervalTime.valueOf();

    intervalTime.setHours(currentHr + hrDelta, currentMin + minDelta);

    if (intervalTime.valueOf() < Date.now()) {
        intervalTime.setTime(previous + interval);
        adjustIntervalTime(intervalTime, interval);
    }
}

/**
 * calculates and sets the next interval time based on a given current time, interval amount, and the interval starting time
 * 
 * @param {Number} intervalTime Date object
 * @param {Number} interval ms
 * @param {Number} epoch ms
 */
function calcNextIntervalTime(intervalTime, interval, epoch) {
    /*
        // formula
        // 'interval' and 'startTime' are in some selected unit
        // division is integer division

        // remove offset (startTime)
        delta = currentTime - startTime

        n = delta / interval

        // for negative deltas, return the nearest interval
        if (delta >= 0) {
            n++
        }

        nextTime = interval * n + startTime

        // the result is the next time interval in the appropriate untis
    */

    const delta = Date.now() - epoch;
    let nearestInterval = Math.trunc(delta / interval);

    if (delta >= 0) {
        nearestInterval++;
    }

    intervalTime.setTime(nearestInterval * interval + epoch);
    // the set time coud have the wrong hrs and mins
    adjustIntervalTime(intervalTime, interval);
}

/**
 * creates a time interval Date object
 * 
 * @param {Number} interval ms
 * @param {Number} epoch ms
 * @returns Date object
 */
function createTimeInterval(interval, epoch) {
    const intervalTime = new Date();
    calcNextIntervalTime(intervalTime, interval, epoch);
    return intervalTime;
}

/**
 * calls timeout repeatedly
 * 
 * @param {Function} callback function
 * @param {Number} ID int
 * @param {Number} interval ms
 * @param {Object} intervalTime Data object
 * @param {Number} epoch ms
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
                    calcNextIntervalTime(intervalTime, interval, epoch);
                }
                else {
                    callback();
                    // daylight savings adjustment
                    adjustIntervalTime(intervalTime, interval);
                }
            }
            else {
                // system time changes less than the interval time
                if (intervalTime.valueOf() - time > interval) {
                    calcNextIntervalTime(intervalTime, interval, epoch);
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
    const epoch = timeArrToMs(parseTimeStr(startingTime));

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
