% Negative: unsatisfiable model
var 1..10: x;
constraint x >= 3;
constraint x <= 2;
solve satisfy;
output ["x = ", show(x)];
