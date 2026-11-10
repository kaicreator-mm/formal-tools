% Negative: triangle is not 2-colorable -> UNSATISFIABLE
{ color(X,red); color(X,blue) } = 1 :- node(X).
:- color(X,C), color(Y,C), edge(X,Y).
node(a). node(b). node(c).
edge(a,b). edge(b,c). edge(c,a).
