/* 内置常识库：分类、默认保质期、开封后保质期、单位、位置预设
 * 仅作为录入时的智能默认值，用户可随时覆盖。 */
window.KB = (function () {
  // 分类：图标 / 末开封默认保质期(天, null=不默认) / 默认位置
  const categories = [
    { id: '零食', icon: '🍪', shelf: 180, loc: '零食柜' },
    { id: '饮料', icon: '🥤', shelf: 365, loc: '冰箱-门架' },
    { id: '蔬菜肉类', icon: '🥩', shelf: 5, loc: '冰箱-冷藏室' },
    { id: '水果', icon: '🍎', shelf: 10, loc: '冰箱-冷藏室' },
    { id: '粮油', icon: '🍚', shelf: 540, loc: '厨房-地柜' },
    { id: '调料', icon: '🧂', shelf: 720, loc: '厨房-吊柜' },
    { id: '蛋奶', icon: '🥚', shelf: 30, loc: '冰箱-冷藏室' },
    { id: '冷冻食品', icon: '🧊', shelf: 180, loc: '冰箱-冷冻室' },
    { id: '日用品', icon: '🧻', shelf: null, loc: '卫生间' },
    { id: '母婴', icon: '🍼', shelf: 365, loc: '卧室-衣柜' },
    { id: '医药', icon: '💊', shelf: 730, loc: '药箱' },
    { id: '美妆', icon: '💄', shelf: 540, loc: '梳妆台' },
    { id: '其他', icon: '📦', shelf: null, loc: '储藏间' }
  ];

  // 常见「开封后保质期」(天)，按商品名关键词匹配（常识，可覆盖）
  const afterOpen = {
    '牛奶': 7, '鲜奶': 7, '酸奶': 7,
    '面包': 3, '蛋糕': 2,
    '熟食': 3, '卤味': 3, '剩菜': 2,
    '番茄酱': 30, '沙拉酱': 30, '蛋黄酱': 30, '酱油': 90, '醋': 180,
    '花生酱': 60, '果酱': 30, '蜂蜜': 9999,
    '咖啡': 30, '茶叶': 180, '奶粉': 30,
    '果汁': 7, '啤酒': 1, '葡萄酒': 3,
    '牙膏': 180, '护肤品': 365, '化妆品': 365,
    '罐头': 7, '米': 90, '面': 60
  };

  // 单位
  const units = ['个', '瓶', '袋', '盒', '包', '罐', '根', '条', '斤', '克', '千克', '升', '毫升', '卷', '支', '片', '双'];

  // 存放位置预设（多层级用「-」分隔）
  const locations = [
    '冰箱-冷藏室', '冰箱-冷冻室', '冰箱-门架', '冰箱-变温室',
    '零食柜', '厨房-吊柜', '厨房-地柜', '厨房-角落',
    '卫生间-洗漱台', '卫生间-柜子', '阳台', '玄关', '书房',
    '卧室-衣柜', '卧室-床头', '药箱', '梳妆台', '储藏间', '鞋柜'
  ];

  // 关键词 -> 分类（用于扫码/批量录入时的智能归类）
  const classifyHints = {
    '零食': ['薯片', '饼干', '巧克力', '糖果', '坚果', '辣条', '膨化'],
    '饮料': ['可乐', '雪碧', '水', '果汁', '茶饮料', '咖啡', '牛奶', '酸奶', '酒'],
    '蔬菜肉类': ['肉', '鸡', '牛', '猪', '鱼', '虾', '蔬菜', '青菜', '西红柿', '土豆', '鸡蛋'],
    '水果': ['苹果', '香蕉', '橙', '梨', '葡萄', '草莓', '西瓜', '芒果'],
    '粮油': ['米', '面', '油', '粮', '粉'],
    '调料': ['酱', '醋', '盐', '糖', '椒', '香料', '料酒'],
    '日用品': ['纸', '巾', '洗', '洁', '肥', '衣', '袜', '电池', '垃圾'],
    '医药': ['药', '膏', '贴', '片', '感冒', '体温'],
    '美妆': ['护肤', '化妆', '唇', '面膜', '香水']
  };

  function classifyByName(name) {
    if (!name) return '其他';
    const n = name.toLowerCase();
    for (const cat in classifyHints) {
      if (classifyHints[cat].some(k => n.includes(k.toLowerCase()))) return cat;
    }
    return '其他';
  }

  function suggestAfterOpen(name) {
    if (!name) return null;
    const n = name.toLowerCase();
    for (const key in afterOpen) {
      if (n.includes(key.toLowerCase())) return afterOpen[key];
    }
    return null;
  }

  function categoryById(id) {
    return categories.find(c => c.id === id) || categories[categories.length - 1];
  }

  return { categories, afterOpen, units, locations, classifyByName, suggestAfterOpen, categoryById };
})();
