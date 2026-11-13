% Positive: satisfiable model
var 1..10: x;
constraint x >= 3;
solve satisfy;
output ["x = ", show(x)];
