import edu.mit.csail.sdg.alloy4.A4Reporter;
import edu.mit.csail.sdg.ast.Command;
import edu.mit.csail.sdg.ast.Module;
import edu.mit.csail.sdg.parser.CompUtil;
import edu.mit.csail.sdg.translator.A4Options;
import edu.mit.csail.sdg.translator.A4Solution;
import edu.mit.csail.sdg.translator.TranslateAlloyToKodkod;

/**
 * Headless runner for the Alloy 6 dist jar (CLI-free environments).
 * Prints ALLOY_CMD lines per command and a final ALLOY_RESULT line.
 * Exit 0 when the file parsed and at least one command was evaluated.
 */
public class AlloyRunner {
    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            System.err.println("usage: AlloyRunner <file.als>");
            System.exit(2);
        }
        A4Reporter rep = new A4Reporter();
        Module world = CompUtil.parseEverything_fromFile(rep, null, args[0]);
        A4Options opt = new A4Options();
        opt.solver = A4Options.SatSolver.SAT4J;
        Command[] cmds = world.getAllCommands();
        if (cmds.length == 0) {
            System.out.println("ALLOY_ERROR: no commands in file");
            System.exit(3);
        }
        boolean anySat = false;
        for (Command cmd : cmds) {
            A4Solution sol = TranslateAlloyToKodkod.execute_command(rep, world.getAllReachableSigs(), cmd, opt);
            boolean sat = sol.satisfiable();
            if (sat) anySat = true;
            System.out.println("ALLOY_CMD " + cmd.label + " -> " + (sat ? "SATISFIABLE" : "UNSATISFIABLE"));
        }
        System.out.println("ALLOY_RESULT: " + (anySat ? "SATISFIABLE" : "UNSATISFIABLE"));
    }
}
