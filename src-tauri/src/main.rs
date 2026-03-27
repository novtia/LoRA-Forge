#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if lora_forge_lib::run_mock_trainer_from_env() {
        return;
    }

    lora_forge_lib::run()
}
