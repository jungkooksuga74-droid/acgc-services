import {
  ArrowUpRight,
  Boxes,
  Check,
  ClipboardList,
  Clock3,
  Hammer,
  Mail,
  MapPin,
  Phone,
  Ruler,
  Scissors,
  Wrench,
} from "lucide-react";
import { useAdminContactPhone } from "@/hooks/useAdminContactPhone";

const services = [
  "Custom Glass Windows & Doors",
  "Aluminum Frames & Partitions",
  "Sliding Doors & Panels",
  "Site Inspection & Consultation",
  "Professional Installation",
];

const process = [
  { title: "Order Request", description: "Submit your custom order with dimensions.", icon: ClipboardList },
  { title: "Site Inspection", description: "Our team visits to take precise measurements.", icon: Ruler },
  { title: "Cutting", description: "Glass and aluminum are cut to the required dimensions.", icon: Scissors },
  { title: "Assembly", description: "Cut components are assembled for your project.", icon: Boxes },
  { title: "Fabrication", description: "Your order is crafted in our workshop.", icon: Hammer },
  { title: "Installation", description: "Professional installation at your location.", icon: Wrench },
];

function AboutBusinessContent({ darkMode = false }) {
  const { phone, phoneHref, address, addressHref, email, emailHref } = useAdminContactPhone();

  return (
    <div className={`about-business-shell${darkMode ? " is-dark" : ""}`}>
      <div className="about-business-content">
        <section className="about-process-card" aria-labelledby="about-process-title">
          <div className="about-process-heading">
            <span className="about-eyebrow">From request to finish</span>
            <h2 id="about-process-title">Our Process</h2>
            <p>A clear, careful process keeps your project moving at every step.</p>
          </div>

          <ol className="about-process-list">
            {process.map(({ title, description, icon: Icon }, index) => (
              <li className="about-process-step" key={title}>
                <span className="about-process-icon">
                  <Icon size={21} aria-hidden="true" />
                  <span className="about-process-number">{index + 1}</span>
                </span>
                <h3>{title}</h3>
                <p>{description}</p>
              </li>
            ))}
          </ol>
        </section>

        <div className="about-details-grid">
          <section className="about-info-card about-services-card" aria-labelledby="about-services-title">
            <header className="about-info-header">
              <span className="about-info-icon"><Wrench size={19} aria-hidden="true" /></span>
              <span>
                <h2 id="about-services-title">Our Services</h2>
                <p>Solutions made to fit your space.</p>
              </span>
            </header>

            <ul className="about-services-list">
              {services.map((service) => (
                <li className="about-service-item" key={service}>
                  <span className="about-service-icon"><Check size={13} strokeWidth={3} aria-hidden="true" /></span>
                  <span className="about-service-label">{service}</span>
                </li>
              ))}
              <li className="about-service-item">
                <span className="about-service-icon"><Clock3 size={13} aria-hidden="true" /></span>
                <span className="about-service-hours-copy">
                  <strong>Business Hours</strong>
                  <span className="about-service-hours-time">Mon–Sat · 8:00 AM – 6:00 PM</span>
                </span>
              </li>
            </ul>
          </section>

          <section className="about-info-card about-contact-card" aria-labelledby="about-contact-title">
            <header className="about-info-header">
              <span className="about-info-icon"><MapPin size={19} aria-hidden="true" /></span>
              <span>
                <h2 id="about-contact-title">Contact Information</h2>
                <p>We’re ready to help with your project.</p>
              </span>
            </header>

            <div className="about-contact-list">
              <a href={emailHref} className="about-contact-item">
                <span className="about-contact-icon"><Mail size={17} aria-hidden="true" /></span>
                <span className="about-contact-copy">
                  <span className="about-contact-label">Email</span>
                  <span className="about-contact-value">{email}</span>
                </span>
                <ArrowUpRight className="about-contact-arrow" size={15} aria-hidden="true" />
              </a>
              <a href={phoneHref} className="about-contact-item">
                <span className="about-contact-icon"><Phone size={17} aria-hidden="true" /></span>
                <span className="about-contact-copy">
                  <span className="about-contact-label">Phone</span>
                  <span className="about-contact-value">{phone}</span>
                </span>
                <ArrowUpRight className="about-contact-arrow" size={15} aria-hidden="true" />
              </a>
              <a href={addressHref} target="_blank" rel="noreferrer" className="about-contact-item">
                <span className="about-contact-icon"><MapPin size={17} aria-hidden="true" /></span>
                <span className="about-contact-copy">
                  <span className="about-contact-label">Address</span>
                  <span className="about-contact-value">{address}</span>
                </span>
                <ArrowUpRight className="about-contact-arrow" size={15} aria-hidden="true" />
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default AboutBusinessContent;
