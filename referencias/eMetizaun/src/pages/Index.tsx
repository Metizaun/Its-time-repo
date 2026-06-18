import CRMLogo from "@/components/CRMLogo";
import LoginForm from "@/components/LoginForm";
const Index = () => {
  return <div className="min-h-screen flex">
      {/* Left Side - Brand */}
      <div className="hidden lg:flex lg:flex-1 brand-surface items-center justify-center p-12">
        <div className="max-w-md text-center lg:text-left">
          <CRMLogo variant="brand" />
          <p className="mt-8 text-lg text-brand-light/80 leading-relaxed">Um sistema que foi desenhado para ter a gestão da sua empresa tão simples quanto te fazer lucrar mais</p>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="flex-1 lg:max-w-lg xl:max-w-xl flex items-center justify-center p-8 lg:p-12">
        <div className="w-full">
          {/* Mobile Logo */}
          <div className="lg:hidden flex justify-center mb-8">
            <CRMLogo variant="default" />
          </div>
          
          <LoginForm />
        </div>
      </div>
    </div>;
};
export default Index;