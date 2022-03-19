# daily-intervals
Create intervals that are based on the time

## Usage

```javascript
import {
    setDailyInterval,
    clearDailyInterval
} from 'daily-intervals';

/*
this executes every 2 hours
the intervals start at 1 am

meaning the times it will execute will be:

      this is the given starting time
                     |
                     V
..., 21:00, 23:00, 1:00, 3:00, 5:00, 7:00, ...
*/
setDailyInterval(() => {
    console.log('hello world');
}, 2 * 60, '1:00');

//------------------
// similar usage to setTimeout and setInterval

setDailyInterval(() => {
    console.log('Hello world 1');
});

setDailyInterval(() => {
    console.log('Hello world 2');
}, 2);

setDailyInterval(() => {
    console.log('Hello world 3');
}, 3, '3:33');

setDailyInterval((a, b, c) => {
    console.log(a, b, c);
}, 4, '4:44', '1', '2', '3');

setDailyInterval("console.log('Hello world 4');");

//------------------
// clearing a dailyInterval

const id = setDailyInterval(() => console.log('cleared'));
clearDailyInterval(id);
```
