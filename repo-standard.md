# 仓库改写规则

> 每次修改、重构或复刻 GitHub 开源项目时，必须严格遵循本规范。

---

## 1. 项目命名格式

```
XIAO_<ChipPlatform>_<KeyTech>_<ProjectName>
```

**命名示例：**
- `XIAO_ESP32_NTP_Clock`
- `XIAO_RP2040_OLED_Weather`
- `XIAO_nRF52840_BLE_Beacon`

---

## 2. 仓库清理规则（必做）

### 必须删除的 GitHub 相关文件
| 文件/目录 | 说明 |
|-----------|------|
| `.git/` | 版本历史（clone 后第一时间删除） |
| `.github/` | GitHub Actions、ISSUE 模板等 |
| `.workflows/` 或 `.github/workflows/` | CI/CD 工作流 |
| `.gitignore` | GitHub 自动生成的规则，可能不适合新项目 |
| **不要删除：`LICENSE`** | **必须保留**，即使项目改名也要保留原仓库的 LICENSE |

### 关于 LICENSE 的重要说明
- `LICENSE` 文件**绝对不能删除**
- 如果误删，必须立即从原仓库重新 clone 并恢复
- 如果原仓库有 `CLA`、`CONTRIBUTING` 等文件，需根据实际情况判断是否保留

---

## 3. README 重写规范

### 3.1 文件结构顺序

```
Logo + Tech Badges      ← 居中，全大写标题
Creator                 ← 作者信息
Project Description     ← 项目简介
Key Features           ← 主要特性（emoji 列表）
Hardware & Software    ← 硬件/软件栈
Quick Start            ← 启动指南（核心内容）
```

---

### 3.2 Logo + Tech Badges（开头部分）

**Logo**
- 选项目标题图，更新日期最新的那张
- 居中显示，放在 `<div align="center">` 中
- 使用相对路径，如 `pics/title.png`

**Tech Badges**
- 放在 Logo 下方，同样居中
- 顺序：**框架/工具 → Chip → Language → Key Tech**
- Badge 数量：通常 3~4 个，根据项目实际涉及的技术选取
- **示例**（ESPclock 项目）：
```markdown
[![PlatformIO](https://img.shields.io/badge/PlatformIO-PlatformIO-red?style=flat&logo=platformio)](https://platformio.org/)
[![ESP32](https://img.shields.io/badge/ESP32-XIAO_ESP32C3-ED7B28?style=flat&logo=seeed)](https://www.seeedstudio.com/xiao-series-page)
[![Arduino](https://img.shields.io/badge/Arduino-C++-00979D?style=flat&logo=arduino)](https://www.arduino.cc/)
[![Wi-Fi](https://img.shields.io/badge/Wi--Fi-NTP_Time-4C9EEB?style=flat&logo=wifi)](https://en.wikipedia.org/wiki/Wi-Fi)
```
- **示例**（zclaw 项目，ESP-IDF 框架）：
```markdown
[![ESP-IDF](https://img.shields.io/badge/ESP--IDF-ESP--IDF-green?style=flat&logo=espressif)](https://docs.espressif.com/projects/esp-idf/)
[![ESP32](https://img.shields.io/badge/ESP32-XIAO_ESP32C3-ED7B28?style=flat&logo=seeed)](https://www.seeedstudio.com/xiao-series-page)
[![C](https://img.shields.io/badge/C-C-A8B9CC?style=flat&logo=c)](https://en.wikipedia.org/wiki/C_(programming_language))
[![AI](https://img.shields.io/badge/AI-LLM_Integration-FF6B6B?style=flat&logo=openai)](https://openai.com/)
```
- **重要**：XIAO 系列芯片的 Badge 链接必须指向 **Seeed Studio**（`https://www.seeedstudio.com/xiao-series-page`），**不能用 Espressif**，图标用 `logo=seeed`
- **去掉**：License badge（因为 LICENSE 文件已保留）
- **去掉**：没有实际链接的 Website / Social link 行
- **Badge 不是固定的 PlatformIO**：根据项目实际使用的框架/工具来选择，比如 ESP-IDF、PlatformIO、Arduino 等

**开头完整写法（示例）**
```markdown
<div align="center">
<img src="pics/title.png" alt="项目名" width="80%">
<br/><br/>

[![框架/工具](https://img.shields.io/badge/框架-名称-颜色?style=flat&logo=对应logo)](链接)
[![芯片](https://img.shields.io/badge/芯片-名称-颜色?style=flat&logo=seeed)](https://www.seeedstudio.com/xiao-series-page)
[![语言](https://img.shields.io/badge/语言-名称-颜色?style=flat&logo=对应logo)](链接)
[![关键技术](https://img.shields.io/badge/关键技术-名称-颜色?style=flat&logo=对应logo)](链接)
</div>
```

> ⚠️ **以上只是示例格式**：根据项目实际情况选择框架/工具、芯片、语言和关键技术 Badge，每个项目 Badge 内容不同，不要照搬 PlatformIO 示例。

---

### 3.3 Creator 部分格式

```markdown
## Creator: [Name](URL)

We sincerely thank the original author and contributors of [**原仓库名**](链接) for their open-source work, which forms the foundation of this project.
```

---

### 3.4 Quick Start 结构（必须严格按此顺序）

**顺序规则**
```
### Hardware Connection   ← 最前：硬件接线
### Software Configuration ← 中间：软件配置烧录步骤
### Assembly              ← 最后：组装外壳
```

**步骤结构**
- 每个步骤编号，对应图片放在**该步骤文字下方**
- Assembly 步骤永远是**最后一步**
- **重要**：
  - **不要 clone 原始仓库的 URL**（复刻后的代码在自己的仓库里，不在原仓库）
  - **不要写原始仓库的 URL 作为 clone 来源**
  - clone 步骤统一写成：`git clone https://github.com/Seeed-Studio/OSHW-XIAO-Series.git` 然后 `cd` 到对应项目目录；或者直接描述为"项目文件在本地仓库的 `projects/community-diy-projects/项目名/` 目录下"

**接线表格写法（居中）**
```markdown
<div align="center">

| XIAO ESP32 C3 | TM1637 Display |
|----------------|----------------|
| GPIO 9         | CLK            |
| GPIO 10        | DIO            |
| 3V3            | VCC            |
| GND            | GND            |

</div>
```

---

### 3.5 图片规范

**不要新建 pics/ 文件夹复制图片，保持原作者定义的图片目录结构。**

**尺寸判断（高÷宽）**

| 比例 | 类型 | 建议宽度 |
|------|------|---------|
| < 0.75 | 横图 | 80% |
| 0.75 ~ 1.5 | 方图 | 60% |
| ≥ 1.5 | 纵图（人像类） | 40% |

**图片居中写法**（路径使用原作者的目录结构，不要强制改为 `pics/`）
```markdown
<div align="center">
<img src="{原作者的图片路径，如 fig/xxx.jpg 或 Images/board.jpg}" alt="描述" width="80%">
</div>
```

**宁缺毋滥原则**
- **没有对应的图片就删掉**，不保留占位
- 不要放与步骤无关的装饰图

---

### 3.6 其他规范

- **全程英文**：标题、正文、描述全部英文
- **图片路径**：用项目目录中的相对路径（如 `fig/xxx.jpg`、`Images/board.jpg`），不要用完整的 GitHub URL 链接
- **删除其他开发板信息**：只保留 XIAO 系列相关内容
- **去除空行**：没有内容的空行描述整行删掉

---

## 4. 检查清单

### 仓库初始化时
- [ ] 从原仓库 clone 后，**立即删除 `.git/`**
- [ ] **保留 `LICENSE` 文件**（如误删需立即恢复）
- [ ] 删除 `.github/`、`.workflows/`、`.gitignore` 等 GitHub 相关文件
- [ ] 对比原仓库 README，列出需要保留的图片和关键信息

### README 重写时
- [ ] 项目名符合命名规范
- [ ] 开头有 Logo + Tech Badges，居中
- [ ] Creator 部分格式正确，包含感谢语
- [ ] Quick Start 按 Hardware → Software → Assembly 顺序
- [ ] 所有图片有对应步骤，无对应图片已删除
- [ ] 纵图宽度 40%，横图 80%
- [ ] 表格和图片都用 `<div align="center">` 居中
- [ ] 全文英文，无多余空行
- [ ] 删除其他开发板的残留描述

### 完成后
- [ ] LICENSE 文件存在
- [ ] 无 .git / .github / .workflows 等目录
- [ ] README 结构符合本规范
