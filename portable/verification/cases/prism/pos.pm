dtmc

module die
  s : [0..7] init 0;
  [] s=0 -> 0.5 : (s'=1) + 0.5 : (s'=2);
  [] s=1 -> 0.5 : (s'=3) + 0.5 : (s'=4);
  [] s=2 -> 0.5 : (s'=5) + 0.5 : (s'=6);
  [] s>=3 & s<=6 -> (s'=7);
endmodule

label "done" = s=7;
