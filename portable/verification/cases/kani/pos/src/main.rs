#[kani::proof]
fn check_bound() {
    let x: u8 = kani::any();
    assert!(x as u16 <= 255);
}

fn main() {}
