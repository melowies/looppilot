import Image from "next/image";

/** The supplied notebook artwork, displayed without filters or cropping. */
export function Brand() {
  return (
    <>
      <Image
        src="/brand/icon.png"
        alt=""
        width={1254}
        height={1254}
        className="brand-illustration"
        loading="eager"
        unoptimized
      />
      <span className="brand-wordmark">LoopPilot</span>
    </>
  );
}
