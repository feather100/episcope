# -*- coding: utf-8 -*-
"""EpiScope 演示数据生成器：生成完全虚构的流感报告卡 CSV（GBK 编码）。
所有姓名/学校/医院/电话/地址均为虚构，不包含任何真实个人信息。
用法: python scripts/generate_demo_data.py [行数]
"""
import random
import sys
from pathlib import Path

random.seed(20251203)

SURNAMES = "王李张刘陈杨赵黄周吴徐孙胡朱高林何郭马罗梁宋郑谢韩唐冯于董萧程曹袁邓许傅沈曾彭吕苏卢蒋蔡贾丁魏薛叶阎余潘杜戴夏钟汪田任姜范方石姚谭廖邹熊金陆郝孔白崔康毛邱秦江史顾侯邵孟龙万段漕钱汤尹黎易常武乔贺赖龚文"
GIVEN = "伟芳娜敏静丽强磊军洋勇艳杰娟涛明超秀兰霞平刚桂英香建华玉红梅俊浩子涵欣怡梓萱雨桐浩然宇轩诗涵晨阳嘉怡思远若曦天佑梦琪晨曦"

def rand_name(rng):
    return rng.choice(SURNAMES) + rng.choice(GIVEN) + (rng.choice(GIVEN) if rng.random() < 0.35 else "")

SCHOOLS = [
    "示例市第一实验小学", "示例市第二小学", "示范区实验小学", "示范区阳光小学",
    "示例市第一中学", "示范中学", "示例市外国语学校", "示范区双语小学",
    "示例市育才小学", "示范区中心幼儿园", "示例市机关幼儿园", "示例区童星幼儿园",
    "示例市第五中学", "示例区明星小学",
]
CLASSES = ["一年级一班","一年级二班","二年级一班","三年级二班","四年级三班","五年级一班","五年级二班","六年级二班","初一1班","初二2班","高一三班","高二1班","高三2班","托1班","小班","中班","大班"]

HOSPITALS = [
    ("示例市第一医院", "A100"), ("示范大学附属医院", "A100"), ("示例区妇幼保健院", "B100"),
    ("示例儿童医院", "A519"), ("示例市第二医院", "A100"), ("示例区人民医院", "A210"),
    ("示例市中西医结合医院", "A210"), ("示范社区卫生服务中心", "B200"),
]
DOCTORS = ["示例医生甲", "示例医生乙", "示例医生丙", "示例医生丁", "示例医生戊"]
USERS = ["录卡员A", "录卡员B", "审核员甲", "审核员乙"]

DISTRICTS = [
    ("朝阳区", "110105"), ("海淀区", "110108"), ("丰台区", "110106"), ("昌平区", "110114"),
    ("通州区", "110112"), ("西城区", "110102"), ("东城区", "110101"), ("大兴区", "110115"),
    ("顺义区", "110113"), ("房山区", "110111"),
]
STREETS = ["示例街道", "示范街道", "阳光街道", "幸福街道", "和平街道", "建设街道", "文化街道", "创新街道"]
ESTATES = ["示例小区", "示范家园", "阳光花园", "幸福里", "和平苑", "建设新苑", "文化佳园", "创新公寓"]

CROWDS = ["学生", "幼托儿童", "散居儿童", "干部职员", "商业服务", "医务人员", "家务及待业", "离退人员", "工人", "教师"]
WEIGHTS = [42, 10, 8, 10, 6, 3, 12, 5, 2, 2]

HEADER = ["卡片ID","卡片编号","卡片状态","患者姓名","患儿家长姓名","性别","出生日期","年龄","患者工作单位","联系电话",
"病人属于","现住地址国标","现住详细地址","人群分类","病例分类","病例分类2","发病日期","诊断时间","死亡日期","疾病名称",
"订正前病种","订正前诊断时间","订正前终审时间","填卡医生","医生填卡日期","报告单位地区编码","报告单位","单位类型",
"报告卡录入时间","录卡用户","录卡用户所属单位","县区审核时间","地市审核时间","省市审核时间","审核状态",
"订正报告时间","订正终审时间","终审死亡时间","订正用户","订正用户所属单位","（删除/标注）时间","（删除/标注）用户",
"（删除/标注）用户所属单位","（删除/未纳入统计）原因","备注"]

def gen_row(i, rng):
    card_id = str(1446000000000000000 + i)
    crowd = rng.choices(CROWDS, weights=WEIGHTS, k=1)[0]
    sex = rng.choice(["男", "女"])
    birth_year = rng.randint(2012, 2022) if crowd in ("学生", "幼托儿童", "散居儿童") else rng.randint(1960, 2000)
    birth = f"{birth_year}/{rng.randint(1,12)}/{rng.randint(1,28)}"
    age = 2025 - birth_year
    if crowd in ("学生", "幼托儿童", "散居儿童"):
        unit = rng.choice(SCHOOLS) + rng.choice(CLASSES)
    elif crowd == "干部职员":
        unit = rng.choice(["示例科技有限公司", "示范集团", "示例事业单位", "示例银行"])
    elif crowd == "离退人员":
        unit = "退休"
    elif crowd == "医务人员":
        unit = rng.choice(HOSPITALS)[0]
    else:
        unit = "无"
    phone = "1" + rng.choice(["38", "39", "86", "55"]) + "".join(str(rng.randint(0,9)) for _ in range(8))
    belongs = rng.choices(["本县区", "本市其它县区", "其他省"], weights=[78, 20, 2], k=1)[0]
    dist, code6 = rng.choice(DISTRICTS)
    addr_code = code6 + "".join(str(rng.randint(0,9)) for _ in range(3))
    addr = f"北京市市辖区{dist}{rng.choice(STREETS)}{rng.choice(ESTATES)}{rng.randint(1,30)}号楼{rng.randint(1,6)}单元{rng.randint(101,602)}"
    case_class = rng.choices(["确诊病例", "临床诊断病例"], weights=[83, 17], k=1)[0]
    onset_d = rng.choices(["2025/12/1", "2025/12/2", "2025/12/3", "2025/12/4", "2025/11/30"], weights=[18, 34, 33, 9, 6], k=1)[0]
    lag = rng.choices([1, 2, 3], weights=[60, 30, 10], k=1)[0]
    onset_day = int(onset_d.rsplit("/", 1)[1])
    dd = min(onset_day + lag, 28)
    diag_d = f"2025/12/{dd}"
    diag_time = f"{diag_d} {rng.randint(8,20)}:{rng.randint(0,59):02d}"
    rec_time = f"{diag_d} {rng.randint(9,21)}:{rng.randint(0,59):02d}"
    audit = f"{diag_d} {rng.randint(18,23)}:{rng.randint(0,59):02d}"
    org, org_type = rng.choice(HOSPITALS)
    org_region = code6 + "000"
    status = rng.choices(["原始卡", "订正卡"], weights=[91, 9], k=1)[0]
    remark = rng.choices(["甲流", "甲流阳性", "甲流核酸阳性", ""], weights=[35, 12, 10, 43], k=1)[0]
    doctor = rng.choice(DOCTORS)
    user = rng.choice(USERS)
    return [card_id, f"{code6}-2025-{i:05d}", status, rand_name(rng), rand_name(rng), sex, birth, f"{age}岁",
            unit, phone, belongs, addr_code, addr, crowd, case_class, "未分型", onset_d, diag_time, ".",
            "流行性感冒", "", "", "", doctor, diag_d, org_region, org, org_type, rec_time, user, org,
            audit, audit, audit, "已终审卡", "", audit, "", "", "", "", "", "", "", remark]

def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 2500
    out_dir = Path(__file__).resolve().parent.parent / "data" / "demo"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "demo_flu_cases.csv"
    rng = random.Random(20251203)
    lines = [",".join(HEADER)]
    for i in range(1, n + 1):
        lines.append(",".join(gen_row(i, rng)))
    text = "\n".join(lines)
    out.write_bytes(text.encode("gbk"))
    print(f"generated {n} rows -> {out} ({out.stat().st_size} bytes, GBK)")

if __name__ == "__main__":
    main()
