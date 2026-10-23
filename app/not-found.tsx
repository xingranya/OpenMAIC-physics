import { BrandStatusPage } from '@/components/physics/brand-status-page';

/**
 * 404 页。
 *
 * 覆盖 Next.js 的默认英文页（"404 | This page could not be found"）：
 * 对参赛现场来说，误点一个链接就露出上游默认页，是「专属产品」印象上不必要的破口。
 */
export default function NotFound() {
  return (
    <BrandStatusPage
      code="404"
      title="没有找到这个页面"
      description="页面地址可能已经变更，或该内容不在本次演示范围内。可以回到物理学习门户，从学生端或教师端入口继续。"
    />
  );
}
