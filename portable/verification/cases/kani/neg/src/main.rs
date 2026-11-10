#[kani::proof]
fn check_bad_bound() {
    let x: u8 = kani::any();
    assert!(x <= 127); // violated for x > 127 -> counterexample
}
