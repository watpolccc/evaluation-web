# Evaluation Web

เว็บไซต์ศูนย์ข้อมูลงานวัดผลและประเมินผล วิทยาลัยพณิชยการเชตุพน

## โครงสร้างไฟล์

```text
evaluation-web-main/
├── index.html
└── assets/
    ├── css/
    │   └── styles.css
    └── js/
        └── app.js
```

- `index.html` เก็บโครงสร้างและเนื้อหาของหน้าเว็บ
- `assets/css/styles.css` เก็บ CSS ที่เขียนเพิ่มเติมจาก Tailwind CSS
- `assets/js/app.js` เก็บการเรียก API การจัดการข้อมูล และการแสดงผล

## แหล่งข้อมูล

หน้าเว็บอ่านข้อมูล JSON จาก Google Apps Script โดย response ต้องมีรูปแบบ:

```json
{
  "status": "success",
  "news": [],
  "documents": [],
  "stats": []
}
```

หัวตารางที่รองรับ:

- `News`: `title`, `date`, `type`, `link`
- `Documents`: `name`, `category`, `link1`, `type1`, `link2`, `type2`
- `Stats`: `title`, `description`, `link`, `imageUrl`

เมื่อแก้ Google Apps Script ต้องสร้าง Deployment เวอร์ชันใหม่ เพื่อให้ URL
ที่ลงท้ายด้วย `/exec` เรียกใช้โค้ดล่าสุด
