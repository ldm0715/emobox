fn main() {
    // tauri-build 2.6 的 rerun-if-changed 只声明了 config/capabilities/资源，不监听
    // icons/ —— 换图标后 build.rs 不重跑，exe 资源里嵌的旧图标会被一直复用
    // （任务栏/标题栏纹丝不动，重启 dev 也没用）。这里显式声明图标目录：
    // 换图标即触发 build 脚本重跑（重嵌入 .res）+ 依赖 crate 重编译
    // （generate_context! 重新展开，default_window_icon 同步更新）。
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
